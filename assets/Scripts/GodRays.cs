using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.RenderGraphModule;
using UnityEngine.Rendering.Universal;

namespace UwuStack
{
    // God rays, as js/post.js draws them on high quality: light shafts that
    // fan out round the tower and the island from the sun's glint on the
    // water. Whatever bright sky and water shows past them is smeared
    // towards the sun at a quarter of the screen's size, then added back over
    // the picture. They fade out as the camera turns away from the sun, and
    // SceneLook dims them by night through _GodRaysLevel.
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
            public Vector3 sunDirection = new Vector3(1f, 0.36f, -1f);      // towards the sun, as Water's _SunDir
            [Range(0f, 2f)] public float intensity = 0.4f;
            [Range(0f, 1f)] public float density = 0.85f;                   // how far back towards the sun each pixel looks
            [Range(0.8f, 1f)] public float decay = 0.955f;                  // how much fainter each step back
            public float threshold = 0.95f;                                 // how bright sky or water must be to light them
            public Color tint = new Color(1f, 0.96f, 0.86f);
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
        }

        class RaysPass : ScriptableRenderPass
        {
            static readonly int SunScreen = Shader.PropertyToID("_SunScreen");
            static readonly int Density = Shader.PropertyToID("_Density");
            static readonly int Decay = Shader.PropertyToID("_Decay");
            static readonly int Threshold = Shader.PropertyToID("_Threshold");
            static readonly int Intensity = Shader.PropertyToID("_Intensity");
            static readonly int Tint = Shader.PropertyToID("_Tint");

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
            }

            public override void RecordRenderGraph(RenderGraph graph, ContextContainer frame)
            {
                UniversalResourceData resources = frame.Get<UniversalResourceData>();
                UniversalCameraData cameraData = frame.Get<UniversalCameraData>();
                if (resources.isActiveTargetBackBuffer) return;

                // Fading out as the camera turns away from the sun, and off
                // once it is behind.
                Camera cam = cameraData.camera;
                Vector3 toSun = settings.sunDirection.normalized;
                float facing = Vector3.Dot(cam.transform.forward, toSun);
                float strength = Mathf.SmoothStep(0f, 1f, Mathf.InverseLerp(-0.1f, 0.4f, facing));
                if (strength <= 0.001f) return;

                // Where the sun lands on the screen, on or off it.
                Vector3 sun = cam.WorldToViewportPoint(cam.transform.position + toSun * 300f);
                material.SetVector(SunScreen, new Vector4(sun.x, sun.y, 0f, 0f));
                material.SetFloat(Density, settings.density);
                material.SetFloat(Decay, settings.decay);
                material.SetFloat(Threshold, settings.threshold);
                material.SetFloat(Intensity, settings.intensity * strength);
                material.SetColor(Tint, settings.tint);

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

                Blit(graph, "God Rays Source", source, lit, 0, AccessFlags.Write);
                Blit(graph, "God Rays Blur", lit, rays, 1, AccessFlags.Write);
                // Added onto the picture, so what is there already is kept.
                Blit(graph, "God Rays Add", rays, source, 2, AccessFlags.ReadWrite);
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
