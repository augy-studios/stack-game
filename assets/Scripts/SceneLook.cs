using UnityEngine;

namespace UwuStack
{
    // Keeps the scene's colours where js/scene.js keeps them: the sky shifts
    // hue with the tower's top layer, easing rather than jumping, and the
    // light or dark theme sets the water, the island, the light, the stars,
    // the meteors and the clouds, in the sky and in the world.
    //
    // Put it on any object and fill in the materials it should drive. It
    // also sets the scene's ambient light to a gradient, as the game's
    // hemisphere light, its fog, and the sun's direction.
    public class SceneLook : MonoBehaviour
    {
        [Header("Materials")]
        public Material sky;        // uwuStack/Sky, also set as the skybox
        public Material water;      // uwuStack/Water
        public Material sand;       // uwuStack/Lambert
        public Material grass;      // uwuStack/Lambert
        public Material rock;       // uwuStack/Lambert
        public Material[] foliage;  // uwuStack/Foliage
        public Material cloud;      // uwuStack/Unlit Transparent
        public Material splashDrop; // uwuStack/Unlit Transparent

        [Header("Light")]
        public Light sun;

        [Header("Camera")]
        public TowerCamera rig;     // the sky pans as it turns

        [Header("Now")]
        public bool dark;
        public int seedNum = 0;
        public int topLayer = 0;

        Color top, horizon, bottom;
        bool ready;

        void OnEnable()
        {
            ready = false;
            RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Trilight;
            RenderSettings.fog = true;
            RenderSettings.fogMode = FogMode.Linear;
            if (sky != null) RenderSettings.skybox = sky;
            // The sun sits up and behind the camera's right, and the water's
            // glint low behind the tower.
            if (sun != null) sun.transform.rotation = Quaternion.LookRotation(-World.FromThree(-2.2f, 5f, 3.4f));
        }

        // Jumps straight to the colours, for a new game.
        public void Snap()
        {
            ready = false;
        }

        void Update()
        {
            int h = Palette.HueOf(seedNum, topLayer);
            Palette.Look look = Palette.For(h, dark);
            if (!ready)
            {
                top = look.SkyTop;
                horizon = look.SkyHorizon;
                bottom = look.SkyBottom;
                ready = true;
            }
            float ease = Mathf.Min(1f, Time.deltaTime * 1.5f);
            top = Palette.Mix(top, look.SkyTop, ease);
            horizon = Palette.Mix(horizon, look.SkyHorizon, ease);
            bottom = Palette.Mix(bottom, look.SkyBottom, ease);
            // The foam follows the eased horizon, as the scene's does.
            if (!dark) look.WaterFoam = Palette.Mix(Color.white, horizon, 0.12f);
            Palette.CloudColours(dark, top, horizon, out Color cloudLit, out Color cloudShade, out Color cloudTint);

            if (sky != null)
            {
                sky.SetColor("_TopColor", top);
                sky.SetColor("_HorizonColor", horizon);
                sky.SetColor("_BottomColor", bottom);
                sky.SetFloat("_Glow", look.Glow);
                sky.SetFloat("_StarsOpacity", look.Stars);
                sky.SetFloat("_Meteors", look.Meteors);
                sky.SetFloat("_Cumulus", look.Cumulus);
                sky.SetFloat("_Cirrus", look.Cirrus);
                sky.SetColor("_CloudLit", cloudLit);
                sky.SetColor("_CloudShade", cloudShade);
                // A turn the width of the view pans the sky a screen across.
                Camera cam = rig != null ? rig.GetComponent<Camera>() : null;
                if (cam != null)
                {
                    float across = 2 * Mathf.Atan(Mathf.Tan(cam.fieldOfView / 2 * Mathf.Deg2Rad) * cam.aspect);
                    sky.SetFloat("_Pan", -rig.Yaw / across);
                }
            }
            if (water != null)
            {
                water.SetColor("_HorizonColor", horizon);
                water.SetColor("_TopColor", top);
                water.SetColor("_DeepColor", look.WaterDeep);
                water.SetColor("_ShallowColor", look.WaterShallow);
                water.SetColor("_FoamColor", look.WaterFoam);
                water.SetFloat("_Glint", look.Glint);
            }
            if (sand != null) sand.SetColor("_BaseColor", look.Sand);
            if (grass != null) grass.SetColor("_BaseColor", look.Grass);
            if (rock != null) rock.SetColor("_BaseColor", look.Rock);
            if (foliage != null)
            {
                foreach (Material m in foliage)
                {
                    if (m != null) m.SetColor("_BaseColor", new Color(look.Foliage, look.Foliage, look.Foliage, 1f));
                }
            }
            if (cloud != null) cloud.SetColor("_BaseColor", new Color(cloudTint.r, cloudTint.g, cloudTint.b, look.Clouds));
            if (splashDrop != null)
            {
                Color drop = Palette.SplashDrop(look);
                drop.a = 0.9f;
                splashDrop.SetColor("_BaseColor", drop);
            }

            // The hemisphere light: the sky's colour from above, grey from
            // below, the horizon between.
            Color skyLight = Palette.Mix(top, Color.white, 0.6f) * look.Ambient;
            Color groundLight = look.AmbientGround * look.Ambient;
            RenderSettings.ambientSkyColor = skyLight;
            RenderSettings.ambientEquatorColor = Color.Lerp(skyLight, groundLight, 0.5f);
            RenderSettings.ambientGroundColor = groundLight;
            RenderSettings.fogColor = horizon;
            if (sun != null) sun.intensity = look.Sun;
        }
    }
}
