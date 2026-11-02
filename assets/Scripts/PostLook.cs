using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

namespace UwuStack
{
    // High quality's post-processing, from js/post.js, on URP's own effects:
    // a soft bloom on whatever is brighter than white (the sun's path on the
    // water, the foam, the sunlit tops), a touch more colour and contrast,
    // the corners a shade darker, and dither so the sky's long gradient
    // shows no bands.
    //
    // Put it on the camera, next to TowerCamera. It builds its own global
    // Volume at runtime, so there is no profile asset to keep in step, and
    // turns the camera's post-processing and HDR on. Tick Low Quality for a
    // slower device and it draws the scene plain, as the web game's Low.
    //
    // The URP Asset needs HDR on for the bloom to find anything past white.
    [RequireComponent(typeof(Camera))]
    public class PostLook : MonoBehaviour
    {
        // No post-processing at all, for a slower device.
        public bool lowQuality;

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
            if (camData == null) return;
            camData.renderPostProcessing = high;
            camData.dithering = high;
        }

        void OnDestroy()
        {
            if (profile != null) Destroy(profile);
        }
    }
}
