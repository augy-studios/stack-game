using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.RenderGraphModule;
using UnityEngine.Rendering.Universal;

namespace UwuStack
{
    // God rays and lens flare, as js/post.js draws them on high quality.
    //
    // The rays: light shafts that fan out round the tower and the island
    // from the sun (Scripts/SunPath.cs). Whatever bright sky and water shows
    // past them is smeared towards the sun at a quarter of the screen's
    // size, then added back over the picture. They fade out as the camera
    // turns away from the sun, and SceneLook dims them by night through
    // _GodRaysLevel.
    //
    // The flare: when the sun is in view, or just past the edge, and not
    // hidden behind the tower: glare and a starburst round it, a streak
    // across, a faint halo ring, and ghosts strung through the middle of the
    // screen. How much of the sun shows is measured each frame into a single
    // pixel that is kept from frame to frame and eased, so the flare fades
    // as the tower slides across it. SunPath.Disc dims it by night and puts
    // it out in rain.
    //
    // A URP renderer feature, for Unity 6's render graph: add it to the
    // Universal Renderer Data asset (Add Renderer Feature > God Rays), with
    // Shaders/GodRays.shader in its Shader field. PostLook switches it off on
    // low quality.
    public class GodRays : ScriptableRendererFeature
    {
        [System.Serializable]
        public class Settings
        {
            public Shader shader;                                           // Hidden/uwuStack/GodRays
            [Range(0f, 2f)] public float intensity = 0.75f;
            [Range(0f, 1f)] public float density = 0.95f;                   // how far back towards the sun each pixel looks
            [Range(0.8f, 1f)] public float decay = 0.968f;                  // how much fainter each step back
            public float threshold = 0.85f;                                 // how bright sky or water must be to light them
            public Color tint = new Color(1f, 0.96f, 0.86f);
            [Range(0f, 2f)] public float flare = 1f;                        // how bright the lens flare is
            public float sunRadius = 0.022f;                                // the sun's radius looked at for the flare, a share of the screen's height
        }

        public Settings settings = new Settings();

        Material material;
        RaysPass pass;

        public override void Create()
        {
            pass = new RaysPass { renderPassEvent = RenderPassEvent.BeforeRenderingPostProcessing };
        }

        public override void AddRenderPasses(ScriptableRenderer renderer, ref RenderingData renderingData)
        {
            CameraType type = renderingData.cameraData.cameraType;
            if (type == CameraType.Preview || type == CameraType.Reflection) return;
            if (material == null)
            {
                Shader shader = settings.shader != null ? settings.shader : Shader.Find("Hidden/uwuStack/GodRays");
                if (shader == null) return;
                material = CoreUtils.CreateEngineMaterial(shader);
            }
            pass.Setup(material, settings);
            pass.ConfigureInput(ScriptableRenderPassInput.Depth);
            renderer.EnqueuePass(pass);
        }

        protected override void Dispose(bool disposing)
        {
            CoreUtils.Destroy(material);
            material = null;
            pass?.Dispose();
        }

        class RaysPass : ScriptableRenderPass
        {
            static readonly int SunScreen = Shader.PropertyToID("_SunScreen");
            static readonly int Density = Shader.PropertyToID("_Density");
            static readonly int Decay = Shader.PropertyToID("_Decay");
            static readonly int Threshold = Shader.PropertyToID("_Threshold");
            static readonly int Intensity = Shader.PropertyToID("_Intensity");
            static readonly int Tint = Shader.PropertyToID("_Tint");
            static readonly int SunRadius = Shader.PropertyToID("_SunRadius");
            static readonly int Flare = Shader.PropertyToID("_Flare");

            // How much of the sun shows, one pixel kept from frame to frame
            // so it eases.
            RTHandle visible;

            Material material;
            Settings settings;

            class Data
            {
                public TextureHandle source;
                public Material material;
                public int pass;
            }

            public RaysPass()
            {
                requiresIntermediateTexture = true;
            }

            public void Setup(Material m, Settings s)
            {
                material = m;
                settings = s;
                if (visible == null)
                {
                    var desc = new RenderTextureDescriptor(1, 1, RenderTextureFormat.ARGB32, 0);
                    visible = RTHandles.Alloc(desc, FilterMode.Point, TextureWrapMode.Clamp, name: "_SunVisible");
                }
            }

            public void Dispose()
            {
                visible?.Release();
                visible = null;
            }

            public override void RecordRenderGraph(RenderGraph graph, ContextContainer frame)
            {
                UniversalResourceData resources = frame.Get<UniversalResourceData>();
                UniversalCameraData cameraData = frame.Get<UniversalCameraData>();
                if (resources.isActiveTargetBackBuffer) return;

                // Where the sun lands on the screen, on or off it, and how
                // much the camera faces it: fading out as the camera turns
                // away, and off once it is behind.
                Camera cam = cameraData.camera;
                Vector3 sun = SunPath.ScreenFor(cam);
                float strength = sun.z;
                float outside = Mathf.Max(0f, Mathf.Max(Mathf.Max(-sun.x, sun.x - 1f), Mathf.Max(-sun.y, sun.y - 1f)));
                float flare = settings.flare * SunPath.Disc * strength * (1f - Mathf.SmoothStep(0f, 1f, Mathf.InverseLerp(0f, 0.3f, outside)));
                if (strength <= 0.001f) return;

                material.SetVector(SunScreen, new Vector4(sun.x, sun.y, 0f, 0f));
                material.SetFloat(Density, settings.density);
                material.SetFloat(Decay, settings.decay);
                material.SetFloat(Threshold, settings.threshold);
                material.SetFloat(Intensity, settings.intensity * strength);
                material.SetColor(Tint, settings.tint);
                material.SetVector(SunRadius, new Vector4(settings.sunRadius * cam.pixelHeight / Mathf.Max(1, cam.pixelWidth), settings.sunRadius, 0f, 0f));
                material.SetFloat(Flare, flare);

                TextureHandle source = resources.activeColorTexture;
                TextureDesc desc = graph.GetTextureDesc(source);
                desc.width = Mathf.Max(1, desc.width / 4);
                desc.height = Mathf.Max(1, desc.height / 4);
                desc.msaaSamples = MSAASamples.None;
                desc.clearBuffer = false;
                desc.filterMode = FilterMode.Bilinear;
                desc.wrapMode = TextureWrapMode.Clamp;
                desc.name = "_GodRaysSource";
                TextureHandle lit = graph.CreateTexture(desc);
                desc.name = "_GodRays";
                TextureHandle rays = graph.CreateTexture(desc);

                // How much of the sun shows, measured before the rays go on
                // and blended into the kept pixel, for the lens flare.
                TextureHandle seen = TextureHandle.nullHandle;
                if (flare > 0.001f)
                {
                    seen = graph.ImportTexture(visible);
                    Blit(graph, "Sun Visible", source, seen, 3, AccessFlags.ReadWrite);
                }

                Blit(graph, "God Rays Source", source, lit, 0, AccessFlags.Write);
                Blit(graph, "God Rays Blur", lit, rays, 1, AccessFlags.Write);
                // Added onto the picture, so what is there already is kept.
                Blit(graph, "God Rays Add", rays, source, 2, AccessFlags.ReadWrite);

                // The lens flare, added onto the picture.
                if (flare > 0.001f) Blit(graph, "Lens Flare", seen, source, 4, AccessFlags.ReadWrite);
            }

            void Blit(RenderGraph graph, string name, TextureHandle from, TextureHandle to, int index, AccessFlags access)
            {
                using (var builder = graph.AddRasterRenderPass<Data>(name, out Data data))
                {
                    data.source = from;
                    data.material = material;
                    data.pass = index;
                    builder.UseTexture(from);
                    // The camera's depth texture, which the shader reads.
                    builder.UseAllGlobalTextures(true);
                    builder.SetRenderAttachment(to, 0, access);
                    builder.SetRenderFunc((Data d, RasterGraphContext ctx) =>
                        Blitter.BlitTexture(ctx.cmd, d.source, new Vector4(1f, 1f, 0f, 0f), d.material, d.pass));
                }
            }
        }
    }
}
