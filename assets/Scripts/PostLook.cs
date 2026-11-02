using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

namespace UwuStack
{
    // High quality's look, from js/scene.js and js/post.js, on URP's own
    // effects: the sun's soft shadows, ambient occlusion where surfaces
    // meet, god rays (Scripts/GodRays.cs), a soft bloom on whatever is
    // brighter than white (the sun's path on the water, the foam, the sunlit
    // tops), a touch more colour and contrast, the corners a shade darker,
    // and dither so the sky's long gradient shows no bands.
    //
    // Put it on the camera, next to TowerCamera. It builds its own global
    // Volume at runtime, so there is no profile asset to keep in step, turns
    // the camera's post-processing and HDR on, and the sun's shadows. Tick
    // Low Quality for a slower device and it draws the scene plain, as the
    // web game's Low.
    //
    // Set up once, in the project:
    //   URP Asset            HDR on; Lighting > Main Light > Cast Shadows on,
    //                        Soft Shadows on; Shadows > Max Distance about 40
    //   Universal Renderer   Add Renderer Feature > Screen Space Ambient
    //   Data                 Occlusion (Source: Depth Normals, Radius 0.32,
    //                        Intensity 0.85), and God Rays; drop the asset
    //                        in Renderer Data below so Low turns both off
    [RequireComponent(typeof(Camera))]
    public class PostLook : MonoBehaviour
    {
        // No shadows, occlusion, rays or post-processing, for a slower device.
        public bool lowQuality;

        // The sun, whose shadows this turns on and off.
        public Light sun;

        // The Universal Renderer Data asset holding the ambient occlusion and
        // God Rays features, to turn them off on low quality. Note that in
        // the Editor this changes the asset itself.
        public UniversalRendererData rendererData;

        // As js/scene.js: soft, and not quite black.
        const float ShadowStrength = 0.9f;

        // js/post.js's numbers. The web game's threshold is linear; URP's
        // is gamma, so 0.92 linear is about 0.96 here. The clamp is its
        // ceiling, so the glint glows rather than flares.
        const float BloomThreshold = 0.96f;
        const float BloomIntensity = 0.4f;
        const float BloomScatter = 0.7f;
        const float BloomClamp = 3f;
        const float Saturation = 6f;     // 1.06 on the web, as URP's -100 to 100
        const float Contrast = 4f;       // 1.04
        const float VignetteIntensity = 0.25f;
        const float VignetteSmoothness = 0.45f;

        Camera cam;
        UniversalAdditionalCameraData camData;
        Volume volume;
        VolumeProfile profile;
        bool? appliedLow;

        void Awake()
        {
            cam = GetComponent<Camera>();
            camData = cam.GetUniversalAdditionalCameraData();

            profile = ScriptableObject.CreateInstance<VolumeProfile>();
            profile.name = "uwuStack Post";

            var bloom = profile.Add<Bloom>(true);
            bloom.threshold.Override(BloomThreshold);
            bloom.intensity.Override(BloomIntensity);
            bloom.scatter.Override(BloomScatter);
            bloom.clamp.Override(BloomClamp);
            bloom.highQualityFiltering.Override(true);

            var grade = profile.Add<ColorAdjustments>(true);
            grade.saturation.Override(Saturation);
            grade.contrast.Override(Contrast);

            var vignette = profile.Add<Vignette>(true);
            vignette.intensity.Override(VignetteIntensity);
            vignette.smoothness.Override(VignetteSmoothness);
            vignette.rounded.Override(true);

            // The web game clips at white rather than tone mapping; keep it so.
            var tone = profile.Add<Tonemapping>(true);
            tone.mode.Override(TonemappingMode.None);

            var holder = new GameObject("uwuStack Post Volume");
            holder.transform.SetParent(transform, false);
            volume = holder.AddComponent<Volume>();
            volume.isGlobal = true;
            volume.priority = 10;
            volume.sharedProfile = profile;

            Apply();
        }

        void Update()
        {
            if (appliedLow != lowQuality) Apply();
        }

        void Apply()
        {
            appliedLow = lowQuality;
            bool high = !lowQuality;
            volume.enabled = high;
            cam.allowHDR = high;
            if (sun != null)
            {
                sun.shadows = high ? LightShadows.Soft : LightShadows.None;
                sun.shadowStrength = ShadowStrength;
            }
            if (rendererData != null)
            {
                foreach (ScriptableRendererFeature feature in rendererData.rendererFeatures)
                {
                    if (feature == null) continue;
                    // URP's own occlusion feature is internal, so it goes by name.
                    if (feature is GodRays || feature.GetType().Name == "ScreenSpaceAmbientOcclusion")
                        feature.SetActive(high);
                }
            }
            if (camData == null) return;
            camData.renderPostProcessing = high;
            camData.dithering = high;
            camData.renderShadows = high;
        }

        void OnDestroy()
        {
            if (profile != null) Destroy(profile);
        }
    }
}
