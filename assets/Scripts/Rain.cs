using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

namespace UwuStack
{
    // The weather, as js/rain.js and the weather parts of js/scene.js and
    // js/view.js: the rain round the tower, each drop's splash, the gusts
    // that slant it, the lightning bolt and its flash, and the thunder.
    //
    // Weather.cs decides it all from the seed and the game's time, so a
    // replay rains as the game did. Put this on any object, fill in the
    // materials and the scene's parts, and each frame set seedNum,
    // difficulty and gameMs (game milliseconds, live or replayed), the top
    // layer's footprint and height, and clear while the start panel shows
    // (its island is never the next game's, so it stays dry). Call Snap()
    // for a new game or a jump in the replay.
    //
    // SceneLook reads Wet, Rainy, Stormy, Flash and FlashX for the grey
    // sky, the dark clouds and the lightning's light; GameAudio is handed
    // the rain's loop level and each roll of thunder.
    [DefaultExecutionOrder(100)]
    public class Rain : MonoBehaviour
    {
        [Header("Materials")]
        public Material drops;      // Materials/RainDrops (uwuStack/Rain)
        public Material splashes;   // Materials/RainSplashes (uwuStack/Rain, Splashes ticked)
        public Material lightning;  // Materials/Lightning (uwuStack/Lightning)

        [Header("Scene")]
        public TowerCamera rig;
        public WaterSurface water;
        public GameAudio sound;
        public bool lowQuality;     // drops but no splashes
        public bool dark;           // the theme, for the drops' colour

        [Header("Now")]
        public string seed = "BXK4-M9TR";
        public string difficulty = "medium";
        public double gameMs;
        public bool clear;
        // The top layer, in world units: centre x, z and half its width and
        // depth, and the height of its top.
        public Vector4 footprint = new Vector4(0, 0, 0.5f, 0.5f);
        public float towerTop;

        // How wet it is as drawn, easing towards the weather's: 0 dry, 0.6
        // light rain, 1 a storm.
        public float Wet { get; private set; }
        // 0 to 1 by light rain's wetness, for the dark clouds; 0 to 1 from
        // light rain's to a storm's.
        public float Rainy => Mathf.Min(1, Wet / 0.6f);
        public float Stormy => Mathf.Clamp01((Wet - 0.6f) / 0.4f);
        // A strike's brightness now, 0 to 1.4, how near it is, and where on
        // the screen it is across, 0 to 1.
        public float Flash { get; private set; }
        public float StrikeNear { get; private set; }
        public float FlashX { get; private set; } = 0.5f;

        // As js/rain.js has them.
        const float Speed = 7.5f;
        const float Streak = 0.26f;
        const float Width = 0.0065f;
        const float Range = 7f;
        const int DropsHigh = 6000;
        const int DropsLow = 2000;
        const float Gust = 2.3f;
        const float BoltHeight = 13f;
        // The calm wind, the web game's (0.38, 0.14), mirrored as World.cs
        // mirrors everything.
        static readonly Vector2 Calm = new Vector2(-0.38f, 0.14f);
        static readonly Color RainGrey = new Color(0.62f, 0.68f, 0.76f);

        uint seedNum;
        string seedFor;
        Weather.Kind kind;
        bool ready;
        double lastMs;
        Vector2 wind = Calm;
        Camera cam;

        GameObject boltObject;
        Mesh boltMesh;
        uint boltSeed;
        bool boltBuilt;
        Vector2 boltAway;

        public void Snap()
        {
            ready = false;
        }

        void Awake()
        {
            boltMesh = new Mesh { name = "Lightning" };
            boltMesh.MarkDynamic();
            boltObject = new GameObject("Lightning");
            boltObject.transform.SetParent(transform, false);
            boltObject.AddComponent<MeshFilter>().sharedMesh = boltMesh;
            var r = boltObject.AddComponent<MeshRenderer>();
            r.sharedMaterial = lightning;
            r.shadowCastingMode = ShadowCastingMode.Off;
            r.receiveShadows = false;
            boltObject.SetActive(false);
        }

        void LateUpdate()
        {
            if (seed != seedFor)
            {
                seedFor = seed;
                seedNum = Weather.SeedNumber(seed);
                ready = false;
            }
            kind = Weather.Of(seedNum, difficulty);
            if (clear) kind = new Weather.Kind();
            float dt = Time.deltaTime;

            // Wetness: snapped for a new game, eased otherwise.
            float want = kind.Rain ? (kind.Storm ? 1f : 0.6f) : 0f;
            bool fresh = !ready;
            Wet = fresh ? want : Wet + (want - Wet) * (1 - Mathf.Exp(-dt * 0.7f));
            if (Mathf.Abs(Wet - want) < 0.001f) Wet = want;

            // Thunder in the time since the last frame, unless it jumped.
            double span = gameMs - lastMs;
            if (!fresh && span > 0 && span < 600 && sound != null)
            {
                Weather.ThunderBetween(kind, seedNum, lastMs, gameMs, e => sound.PlayThunder(e.Near, e.Side));
            }
            lastMs = gameMs;
            ready = true;
            if (sound != null) sound.SetRain(kind.Rain ? (kind.Storm ? 1f : 0.8f) : 0f);

            bool striking = Weather.StrikeAt(kind, seedNum, gameMs, out Weather.Event strike);
            Flash = striking ? Weather.FlashOf(strike) : 0;
            StrikeNear = striking ? strike.Near : 0;

            // A gust, eased into and out of.
            Weather.Gust g = Weather.WindAt(kind, seedNum, gameMs);
            Vector2 wantWind = Calm + new Vector2(-Mathf.Cos(g.Angle), Mathf.Sin(g.Angle)) * (Gust * g.Strength);
            wind = fresh ? wantWind : Vector2.Lerp(wind, wantWind, 1 - Mathf.Exp(-dt * 2.5f));

            if (cam == null && rig != null) cam = rig.GetComponent<Camera>();
            if (cam == null) return;
            Vector3 target = rig.Target;
            Vector3 eye = cam.transform.position;
            float level = water != null ? water.level : World.FromGame(0, Rules.WaterStart, 0).y;

            DrawRain(target, eye, level);
            DrawBolt(striking, strike, target, eye, level);
        }

        void DrawRain(Vector3 target, Vector3 eye, float level)
        {
            if (Wet <= 0.005f || drops == null) return;
            var centre = new Vector4(target.x + (eye.x - target.x) * 0.35f, target.y + 4.5f, target.z + (eye.z - target.z) * 0.35f, 0);
            float pixel = 2 * Mathf.Tan(cam.fieldOfView / 2 * Mathf.Deg2Rad) / Mathf.Max(1, cam.pixelHeight);
            Color horizon = RenderSettings.fogColor;
            Color drop = Palette.Mix(horizon, RainGrey, 0.5f) * (dark ? 1.25f : 0.8f);
            Color splash = Palette.Mix(horizon, Color.white, 0.75f);
            float time = Time.time;

            foreach (Material m in new[] { drops, splashes })
            {
                if (m == null) continue;
                m.SetFloat("_RainTime", time);
                m.SetVector("_Centre", centre);
                m.SetFloat("_Range", Range);
                m.SetFloat("_Speed", Speed);
                m.SetVector("_Wind", new Vector4(wind.x, wind.y, 0, 0));
                m.SetFloat("_Level", level);
                m.SetVector("_Tower", footprint);
                m.SetFloat("_TowerTop", towerTop);
                m.SetFloat("_Amount", Wet);
                m.SetFloat("_Length", Streak);
                m.SetFloat("_Width", Width);
                m.SetFloat("_Pixel", pixel);
                m.SetFloat("_Flash", Flash);
            }
            drops.SetColor("_Colour", drop);
            // Low quality's drops are a pixel wide, so they need more to show.
            drops.SetFloat("_Opacity", lowQuality ? 1f : 0.75f);

            int count = lowQuality ? DropsLow : DropsHigh;
            var bounds = new Bounds(new Vector3(centre.x, target.y, centre.z), new Vector3(Range * 2 + 4, 40, Range * 2 + 4));
            Graphics.RenderPrimitives(new RenderParams(drops) { worldBounds = bounds, shadowCastingMode = ShadowCastingMode.Off }, MeshTopology.Triangles, 6, count);
            if (!lowQuality && splashes != null)
            {
                splashes.SetColor("_Colour", splash);
                splashes.SetFloat("_Opacity", 0.6f);
                Graphics.RenderPrimitives(new RenderParams(splashes) { worldBounds = bounds, shadowCastingMode = ShadowCastingMode.Off }, MeshTopology.Triangles, 12, count);
            }
        }

        void DrawBolt(bool striking, Weather.Event strike, Vector3 target, Vector3 eye, float level)
        {
            bool on = striking && Flash > 0.001f && lightning != null;
            boltObject.SetActive(on);
            if (!on) return;
            if (!boltBuilt || strike.Seed != boltSeed)
            {
                boltSeed = strike.Seed;
                boltBuilt = true;
                BuildBolt(boltMesh, strike.Seed, BoltHeight);
                // Out past the tower, the way the camera looks.
                boltAway = new Vector2(target.x - eye.x, target.z - eye.z).normalized;
            }
            // The camera looks down on the tower, so the sky past it is out
            // of the picture: the bolt comes down into the far sea, where it
            // fades into the haze at the top of the view.
            float far = 16 + 10 * (1 - strike.Near);
            float side = strike.Side * 8 + Mathf.Sign(strike.Side == 0 ? 1 : strike.Side) * 4;
            var at = new Vector3(
                target.x + boltAway.x * far - boltAway.y * side,
                level - 1,
                target.z + boltAway.y * far + boltAway.x * side);
            boltObject.transform.position = at;
            var face = new Vector3(eye.x - at.x, 0, eye.z - at.z);
            if (face.sqrMagnitude > 1e-6f) boltObject.transform.rotation = Quaternion.LookRotation(face);
            lightning.SetFloat("_Bright", Flash * (0.55f + 0.45f * strike.Near));
            FlashX = cam.WorldToViewportPoint(at + Vector3.up * 3).x;
        }

        struct Segment
        {
            public Vector2 a, b;
            public float level, width;
        }

        // js/rain.js's boltGeometry(): a line from the clouds, height high,
        // down to 0, halved again and again with each middle pushed
        // sideways, less each time, and now and then a fork off at an angle,
        // dimmer and thinner. Then a ribbon along every piece.
        public static void BuildBolt(Mesh mesh, uint seed, float height)
        {
            var rand = new Weather.Lcg(seed);
            float R() => (float)rand.Next();
            var segs = new List<Segment>
            {
                new Segment { a = new Vector2((R() - 0.5f) * height * 0.12f, height), b = new Vector2((R() - 0.5f) * height * 0.3f, 0), level = 1, width = 1 },
            };
            float offset = height * 0.16f;
            for (int gen = 0; gen < 8; gen++)
            {
                var next = new List<Segment>(segs.Count * 2 + 8);
                foreach (Segment s in segs)
                {
                    Vector2 d = s.b - s.a;
                    float len = Mathf.Max(1e-6f, d.magnitude);
                    float push = (R() * 2 - 1) * offset * Mathf.Sqrt(s.width);
                    Vector2 mid = (s.a + s.b) / 2 + new Vector2(-d.y / len, d.x / len) * push;
                    next.Add(new Segment { a = s.a, b = mid, level = s.level, width = s.width });
                    next.Add(new Segment { a = mid, b = s.b, level = s.level, width = s.width });
                    if (gen >= 1 && gen < 6 && R() < 0.2f * s.width)
                    {
                        float turn = (R() < 0.5f ? -1 : 1) * (0.35f + R() * 0.55f);
                        Vector2 m = mid - s.a;
                        float k = 0.8f + R() * 0.9f;
                        var end = mid + new Vector2(m.x * Mathf.Cos(turn) - m.y * Mathf.Sin(turn), m.x * Mathf.Sin(turn) + m.y * Mathf.Cos(turn)) * k;
                        next.Add(new Segment { a = mid, b = end, level = s.level * 0.45f, width = s.width * 0.5f });
                    }
                }
                segs = next;
                offset *= 0.55f;
            }

            const float core = 0.045f;
            var vertices = new List<Vector3>(segs.Count * 4);
            var uvs = new List<Vector2>(segs.Count * 4);
            var index = new List<int>(segs.Count * 6);
            foreach (Segment s in segs)
            {
                Vector2 d = s.b - s.a;
                float len = Mathf.Max(1e-6f, d.magnitude);
                float half = core * 6 * Mathf.Max(0.45f, s.width);
                var n = new Vector2(-d.y / len, d.x / len) * half;
                // Stretched a little each way so the joints meet.
                Vector2 e = d / len * half * 0.15f;
                int i = vertices.Count;
                vertices.Add(s.a - e + n);
                vertices.Add(s.a - e - n);
                vertices.Add(s.b + e + n);
                vertices.Add(s.b + e - n);
                uvs.Add(new Vector2(1, s.level));
                uvs.Add(new Vector2(-1, s.level));
                uvs.Add(new Vector2(1, s.level));
                uvs.Add(new Vector2(-1, s.level));
                index.Add(i); index.Add(i + 1); index.Add(i + 2);
                index.Add(i + 1); index.Add(i + 3); index.Add(i + 2);
            }
            mesh.Clear();
            mesh.indexFormat = vertices.Count > 65000 ? IndexFormat.UInt32 : IndexFormat.UInt16;
            mesh.SetVertices(vertices);
            mesh.SetUVs(0, uvs);
            mesh.SetTriangles(index, 0);
            mesh.bounds = new Bounds(new Vector3(0, height / 2, 0), new Vector3(height * 1.5f, height * 1.2f, 1));
        }
    }
}
