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
    //
    // The sun moves as js/scene.js moves it (Scripts/SunPath.cs): each
    // game's seed puts it somewhere a little different and it wanders
    // slowly by gameMs, so set seedNum and gameMs each frame. The key light,
    // the water's glint, the sky's glow, the sun's disc (Scripts/SunDisc.cs)
    // and the god rays and lens flare (Scripts/GodRays.cs) follow it.
    //
    // With Rain filled in, the weather too, as js/scene.js: any rain greys
    // the sky, brings dark slate clouds, thickens them, puts out the stars,
    // dims the sun and its glint and the god rays; a storm more so; and a
    // lightning strike lights the sky round the bolt, the scene and the
    // water's mirrored sky.
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

        [Header("Weather")]
        public Rain rain;           // optional

        [Header("Now")]
        public bool dark;
        public int seedNum = 0;
        public int topLayer = 0;
        public double gameMs = 0;   // the game's time, live or replayed, for the sun's wander

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
            // glint low behind the tower; Update() turns both each game.
            if (sun != null) sun.transform.rotation = Quaternion.LookRotation(-SunPath.KeyFrom);
        }

        // Jumps straight to the colours, for a new game.
        public void Snap()
        {
            ready = false;
        }

        // Towards its own grey by k, and darker by dim.
        static Color Overcast(Color c, float k, float dim)
        {
            float l = c.r * 0.3f + c.g * 0.59f + c.b * 0.11f;
            Color o = Color.Lerp(c, new Color(l, l, l, c.a), k) * (1 - dim);
            o.a = c.a;
            return o;
        }

        // Rain clouds' lit tops and dark undersides, slate grey, and the
        // light of a strike.
        static readonly Color RainLit = new Color(0.56f, 0.58f, 0.63f);
        static readonly Color RainShade = new Color(0.3f, 0.32f, 0.37f);
        static readonly Color FlashLight = new Color(0.85f, 0.88f, 1.0f);

        void Update()
        {
            int h = Palette.HueOf(seedNum, topLayer);
            Palette.Look look = Palette.For(h, dark);
            float wet = rain != null ? rain.Wet : 0;
            float r = rain != null ? rain.Rainy : 0;
            float storm = rain != null ? rain.Stormy : 0;
            float flash = rain != null ? rain.Flash : 0;
            if (wet > 0)
            {
                look.SkyTop = Overcast(look.SkyTop, 0.7f * r, 0.3f * r + 0.15f * storm);
                look.SkyHorizon = Overcast(look.SkyHorizon, 0.65f * r, 0.32f * r + 0.12f * storm);
                look.SkyBottom = Overcast(look.SkyBottom, 0.55f * r, 0.22f * r + 0.12f * storm);
                look.Glow *= 1 - 0.85f * r;
                look.Stars *= 1 - wet;
                look.Meteors *= 1 - wet;
                look.Cumulus = Mathf.Min(1, look.Cumulus + 0.15f * r);
                look.Clouds = Mathf.Min(0.95f, look.Clouds + 0.12f * r);
                look.Glint *= 1 - 0.8f * r - 0.1f * storm;
                look.WaterDeep = Overcast(look.WaterDeep, 0.3f * wet, 0.08f * wet);
                look.WaterShallow = Overcast(look.WaterShallow, 0.3f * wet, 0.08f * wet);
                look.Sun *= 1 - 0.4f * r - 0.15f * storm;
                look.Ambient *= 1 - 0.1f * wet;
            }
            // The sun's disc and flare: full by day, a pale moon by night,
            // gone in rain.
            float disc = (dark ? 0.3f : 1f) * (1 - Mathf.Min(1f, 1.2f * r));
            SunPath.Place(unchecked((uint)seedNum), gameMs);
            SunPath.Disc = disc;
            Shader.SetGlobalVector("_SunGlint", SunPath.Glint);
            Shader.SetGlobalFloat("_SunSkyY", SunPath.SkyY);
            Shader.SetGlobalFloat("_SunDisc", disc);

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
            if (r > 0)
            {
                // Any rain brings dark rain clouds, a storm's darker still.
                float deep = (dark ? 0.45f : 1f) * (1 - 0.3f * storm);
                cloudLit = Color.Lerp(cloudLit, RainLit * deep, r);
                cloudShade = Color.Lerp(cloudShade, RainShade * deep, r);
                cloudTint = Color.Lerp(cloudTint, RainLit * (deep * 0.95f), r);
            }

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
                sky.SetFloat("_Overcast", Mathf.Max(wet, 0.8f * r));
                sky.SetFloat("_Flash", flash * (0.5f + 0.5f * (rain != null ? rain.StrikeNear : 0)) * 0.7f);
                if (rain != null) sky.SetFloat("_FlashX", rain.FlashX);
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
                // A strike lights the sky the water mirrors.
                float lit = flash * (0.5f + 0.5f * (rain != null ? rain.StrikeNear : 0));
                water.SetColor("_HorizonColor", Color.Lerp(horizon, FlashLight, Mathf.Min(1, 0.25f * lit)));
                water.SetColor("_TopColor", Color.Lerp(top, FlashLight, Mathf.Min(1, 0.25f * lit)));
                water.SetColor("_DeepColor", look.WaterDeep);
                water.SetColor("_ShallowColor", look.WaterShallow);
                water.SetColor("_FoamColor", look.WaterFoam);
                water.SetFloat("_Glint", look.Glint);
                water.SetVector("_SunDir", SunPath.Glint);
            }
            // The god rays, as bright as the glint: full by day, faint by
            // night (Scripts/GodRays.cs).
            Shader.SetGlobalFloat("_GodRaysLevel", look.Glint);
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
            float strikeLight = flash * (0.5f + 0.5f * (rain != null ? rain.StrikeNear : 0));
            Color skyLight = Color.Lerp(Palette.Mix(top, Color.white, 0.6f), FlashLight, Mathf.Min(1, 0.6f * strikeLight)) * (look.Ambient + 0.8f * strikeLight);
            Color groundLight = look.AmbientGround * look.Ambient;
            RenderSettings.ambientSkyColor = skyLight;
            RenderSettings.ambientEquatorColor = Color.Lerp(skyLight, groundLight, 0.5f);
            RenderSettings.ambientGroundColor = groundLight;
            RenderSettings.fogColor = horizon;
            if (sun != null)
            {
                sun.intensity = look.Sun;
                sun.transform.rotation = Quaternion.LookRotation(-SunPath.KeyFrom);
                // Softer shadows under cloud.
                if (sun.shadows != LightShadows.None) sun.shadowStrength = 0.9f * (1 - 0.45f * wet);
            }
        }
    }
}
