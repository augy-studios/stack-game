using UnityEngine;

namespace UwuStack
{
    // Every colour the scene uses, from js/scene.js. Colours come back as
    // sRGB, as a Color is set in the Inspector; Unity converts them for a
    // linear project when they go into a material.
    //
    // three.js mixes colours in linear space, so the blends here do too,
    // which is what Mix() is for.
    public static class Palette
    {
        // A layer's hue: the seed picks where on the wheel the tower starts,
        // and every layer turns it 6 degrees, so the tower fades through the
        // colours as it climbs.
        public static int HueOf(int seedNum, int n)
        {
            return (((seedNum % 360) - n * 6) % 360 + 360) % 360;
        }

        // Pastel, like everything else in the game.
        public static Color Layer(int seedNum, int n)
        {
            return Hsl(HueOf(seedNum, n) / 360f, 0.52f, 0.64f);
        }

        // A perfect drop's plate: the layer's colour, washed towards white.
        public static Color RingPlate(Color layer)
        {
            return Mix(layer, Color.white, 0.35f);
        }

        // The site's brand green, which the horizon leans towards.
        public static readonly Color Brand = Hex(0xccffcc);

        public static readonly Color FlowerPink = Hex(0xf6a9c8);
        public static readonly Color FlowerWhite = Hex(0xfbf6ee);
        public static readonly Color FlowerLilac = Hex(0xc7b2f0);
        public static readonly Color FlowerYellow = Hex(0xffe08a);
        public static readonly Color FlowerPeach = Hex(0xffb79a);

        // The scene in one theme: the light or the dark.
        public struct Look
        {
            public Color SkyTop, SkyHorizon, SkyBottom;
            public float Glow, Stars, Clouds;
            // The sky shader's meteors, and how strongly it lays on its
            // cumulus and cirrus layers.
            public float Meteors, Cumulus, Cirrus;
            public Color WaterDeep, WaterShallow, WaterFoam;
            public float Glint;
            public Color Sand, Grass, Rock;
            public float Foliage;
            // The hemisphere light: its sky colour, its ground colour, how
            // bright; and the sun's brightness.
            public Color AmbientSky, AmbientGround;
            public float Ambient, Sun;
        }

        // The sky for a tower whose top layer has hue h. SceneLook.cs eases
        // towards it, so the sky drifts rather than jumps.
        public static Look For(int h, bool dark)
        {
            System.Func<int, float> hh = x => (((h + x) % 360) + 360) % 360 / 360f;
            var look = new Look();
            if (dark)
            {
                look.SkyTop = Hsl(hh(50), 0.5f, 0.08f);
                look.SkyHorizon = Mix(Hsl(hh(15), 0.38f, 0.2f), Brand, 0.08f);
                look.SkyBottom = Hsl(hh(0), 0.32f, 0.13f);
                look.WaterDeep = Hsl(0.58f, 0.45f, 0.15f);
                look.WaterShallow = Hsl(0.52f, 0.42f, 0.24f);
                look.WaterFoam = Hsl(0.55f, 0.2f, 0.5f);
                look.Glint = 0.35f;
                look.Glow = 0.08f;
                look.Ambient = 1.0f;
                look.Sun = 1.2f;
                look.Stars = 0.9f;
                look.Clouds = 0.7f;
                look.Meteors = 0.9f;
                look.Cumulus = 0.7f;
                look.Cirrus = 0.3f;
                look.Sand = Hex(0xa89a78);
                look.Grass = Hex(0x6f9a62);
                look.Foliage = 0.7f;
            }
            else
            {
                look.SkyTop = Hsl(hh(55), 0.55f, 0.72f);
                look.SkyHorizon = Mix(Hsl(hh(20), 0.7f, 0.86f), Brand, 0.2f);
                look.SkyBottom = Hsl(hh(0), 0.55f, 0.8f);
                look.WaterDeep = Hsl(0.55f, 0.5f, 0.55f);
                look.WaterShallow = Hsl(0.49f, 0.5f, 0.7f);
                look.WaterFoam = Mix(Color.white, look.SkyHorizon, 0.12f);
                look.Glint = 1f;
                look.Glow = 0.35f;
                look.Ambient = 1.5f;
                look.Sun = 1.7f;
                look.Stars = 0.6f;
                look.Clouds = 0.85f;
                look.Meteors = 0f;
                look.Cumulus = 0.85f;
                look.Cirrus = 0.55f;
                look.Sand = Hex(0xe9d7a8);
                look.Grass = Hex(0x9fcf8f);
                look.Foliage = 1f;
            }
            look.Rock = Hex(0xb9b4ad);
            look.AmbientSky = Mix(look.SkyTop, Color.white, 0.6f);
            look.AmbientGround = Hex(0x8a8a9a);
            return look;
        }

        // The clouds' colours from the eased sky: the sky shader's lit and
        // shaded cloud, and the tint of the cloud sprites.
        public static void CloudColours(bool dark, Color top, Color horizon, out Color lit, out Color shade, out Color sprite)
        {
            if (dark)
            {
                lit = Mix(horizon, Color.white, 0.22f);
                shade = Mix(top, horizon, 0.45f);
                sprite = Mix(horizon, Color.white, 0.3f);
            }
            else
            {
                lit = Mix(Color.white, horizon, 0.08f);
                shade = (Mix(top, Color.white, 0.3f).linear * 0.9f).gamma;
                sprite = Mix(Color.white, horizon, 0.1f);
            }
        }

        // The splash's drops: the shallows washed with foam.
        public static Color SplashDrop(Look look)
        {
            return Mix(look.WaterShallow, look.WaterFoam, 0.75f);
        }

        // a to b by t, mixed in linear space as three.js mixes.
        public static Color Mix(Color a, Color b, float t)
        {
            return Color.Lerp(a.linear, b.linear, t).gamma;
        }

        public static Color Hex(int rgb)
        {
            return new Color(((rgb >> 16) & 255) / 255f, ((rgb >> 8) & 255) / 255f, (rgb & 255) / 255f, 1f);
        }

        // Hue, saturation and lightness, each 0 to 1, as three.js's setHSL.
        public static Color Hsl(float h, float s, float l)
        {
            h = Mathf.Repeat(h, 1f);
            s = Mathf.Clamp01(s);
            l = Mathf.Clamp01(l);
            if (s == 0) return new Color(l, l, l, 1f);
            float p = l <= 0.5f ? l * (1 + s) : l + s - l * s;
            float q = 2 * l - p;
            return new Color(Hue(q, p, h + 1f / 3), Hue(q, p, h), Hue(q, p, h - 1f / 3), 1f);
        }

        static float Hue(float p, float q, float t)
        {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1f / 6) return p + (q - p) * 6 * t;
            if (t < 1f / 2) return q;
            if (t < 2f / 3) return p + (q - p) * 6 * (2f / 3 - t);
            return p;
        }
    }
}
