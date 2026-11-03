using System;

namespace UwuStack
{
    // The weather a game is played in, as js/weather.js: whether it rains,
    // when the thunder rolls, when lightning strikes and when a gust blows.
    // Plain C#, drawn from the seed with the same unsigned 32-bit sums as
    // the JavaScript, so a seed gets exactly the same weather in both.
    //
    // One game in ten starts in the rain; on Hard one in four, and Hard's
    // rain is a storm, with lightning and its thunder after it, the further
    // off the later and the softer. Ordinary rain has no lightning, only a
    // distant roll of thunder now and then. In any rain a light gust now and
    // then slants it for a few seconds.
    //
    // Times are game milliseconds.
    public static class Weather
    {
        public struct Kind
        {
            public bool Rain;
            public bool Storm;
        }

        // A roll of thunder, and for a storm the strike before it.
        public struct Event
        {
            public double At;       // when the strike lights the sky, or the roll starts
            public double Thunder;  // when the thunder starts
            public float Near;      // 0 far off, 1 close by
            public float Side;      // -1 to 1, where across the sky
            public uint Seed;       // for its shape
            public bool Flash;      // a storm's, with lightning
            public double Age;      // StrikeAt(): ms since it struck
        }

        public struct Gust
        {
            public float Strength;  // 0 still, up to 1
            // Radians round from x towards z in the web game's world. Unity's
            // mirrors x, so its direction is (-cos, sin): see Rain.cs.
            public float Angle;
        }

        const uint RainSalt = 0x7261696e;
        const uint EventSalt = 0x7468756e;
        const uint GustSalt = 0x77696e64;

        const int SlotRain = 26000, SlotStorm = 12000;
        const int OddsRain = 55, OddsStorm = 80;
        const int Quiet = 3500;
        public const int FlashMs = 650;
        const int DelayMs = 700;
        const int DelaySpread = 2800;

        const int GustSlot = 18000;
        const int GustOdds = 60;
        const int GustMs = 4000;
        const int GustSpread = 4000;

        // js/seed.js's seedNumber(): FNV-1a over the seed's characters.
        public static uint SeedNumber(string seed)
        {
            uint h = 0x811c9dc5;
            foreach (char c in seed)
            {
                h ^= c;
                h *= 0x01000193;
            }
            return h;
        }

        // js/seed.js's mix(): murmur3's finaliser over a golden ratio step.
        public static uint Mix(uint a, uint b)
        {
            uint h = a ^ ((b + 0x9e3779b9u) * 0x85ebca6bu);
            h ^= h >> 16;
            h *= 0x85ebca6bu;
            h ^= h >> 13;
            h *= 0xc2b2ae35u;
            h ^= h >> 16;
            return h;
        }

        // difficulty: "easy", "medium" or "hard".
        public static Kind Of(uint seedNum, string difficulty)
        {
            uint n = difficulty == "hard" ? 4u : 10u;
            bool rain = Mix(seedNum, RainSalt) % n == 0;
            return new Kind { Rain = rain, Storm = rain && difficulty == "hard" };
        }

        static bool EventIn(Kind w, uint seedNum, long k, out Event e)
        {
            e = default;
            int slot = w.Storm ? SlotStorm : SlotRain;
            uint h = Mix(Mix(seedNum, EventSalt), (uint)k);
            if (h % 100 >= (w.Storm ? OddsStorm : OddsRain)) return false;
            uint h2 = Mix(h, 1);
            uint h3 = Mix(h, 2);
            double at = k * (double)slot + Quiet + (h2 % (uint)(slot - 2 * Quiet));
            if (w.Storm)
            {
                float near = (h3 % 1000) / 1000f;
                float side = ((int)(Mix(h, 3) % 2001) - 1000) / 1000f;
                e = new Event { At = at, Thunder = at + DelayMs + Math.Round((1 - near) * DelaySpread), Near = near, Side = side, Seed = Mix(h, 4), Flash = true };
            }
            else
            {
                e = new Event { At = at, Thunder = at, Near = (h3 % 350) / 1000f, Side = 0, Seed = Mix(h, 4), Flash = false };
            }
            return true;
        }

        // Calls each(event) for every roll of thunder that starts in (from, to].
        public static void ThunderBetween(Kind w, uint seedNum, double from, double to, Action<Event> each)
        {
            if (!w.Rain || !(to > from)) return;
            int slot = w.Storm ? SlotStorm : SlotRain;
            long first = Math.Max(0, (long)Math.Floor((from - DelayMs - DelaySpread) / slot));
            long last = (long)Math.Floor(to / slot);
            for (long k = first; k <= last; k++)
            {
                if (EventIn(w, seedNum, k, out Event e) && e.Thunder > from && e.Thunder <= to) each(e);
            }
        }

        // The strike lighting the sky at t, if there is one.
        public static bool StrikeAt(Kind w, uint seedNum, double t, out Event strike)
        {
            strike = default;
            if (!w.Storm || t < 0) return false;
            long k = (long)Math.Floor(t / SlotStorm);
            for (long j = k; j >= k - 1 && j >= 0; j--)
            {
                if (EventIn(w, seedNum, j, out Event e) && t >= e.At && t < e.At + FlashMs)
                {
                    e.Age = t - e.At;
                    strike = e;
                    return true;
                }
            }
            return false;
        }

        // The gust blowing at t: about every forty seconds one eases up for
        // four to eight seconds and dies away, across the camera's usual
        // view so the slant shows.
        public static Gust WindAt(Kind w, uint seedNum, double t)
        {
            if (!w.Rain || t < 0) return new Gust();
            float baseAngle = Mix(seedNum, GustSalt) % 2 == 1 ? 2.356f : -0.785f;
            long k = (long)Math.Floor(t / GustSlot);
            for (long j = k; j >= k - 1 && j >= 0; j--)
            {
                uint h = Mix(Mix(seedNum, GustSalt + 1), (uint)j);
                if (h % 100 >= GustOdds) continue;
                double length = GustMs + Mix(h, 1) % GustSpread;
                double at = j * (double)GustSlot + 2000 + Mix(h, 2) % (GustSlot - 4000);
                double u = (t - at) / length;
                if (u < 0 || u > 1) continue;
                double s = Math.Sin(Math.PI * u);
                float strength = (float)((0.55 + (Mix(h, 3) % 450) / 1000.0) * s * s);
                float angle = baseAngle + ((Mix(h, 4) % 1001) / 1000f - 0.5f) * 0.7f;
                return new Gust { Strength = strength, Angle = angle };
            }
            return new Gust { Strength = 0, Angle = baseAngle };
        }

        // js/rain.js's lcg(): a repeatable sequence from a 32-bit seed.
        public sealed class Lcg
        {
            uint s;
            public Lcg(uint seed) { s = seed == 0 ? 1u : seed; }
            public double Next()
            {
                s = s * 1664525u + 1013904223u;
                return s / 4294967296.0;
            }
        }

        // How bright a strike is, as js/rain.js's flashOf(): its two to four
        // return strokes, each a sharp flash that dies in tens of
        // milliseconds, the later ones weaker, and the channel's faint glow
        // between them fading out at the end. 0 to 1.4.
        public static float FlashOf(Event strike)
        {
            var rand = new Lcg(strike.Seed);
            int strokes = 2 + (int)Math.Floor(rand.Next() * 3);
            double at = 0, level = 1, f = 0;
            for (int i = 0; i < strokes; i++)
            {
                double u = strike.Age - at;
                if (u >= 0) f += level * Math.Exp(-u / (i == 0 ? 55 : 40));
                at += 55 + rand.Next() * 110;
                level *= 0.55 + rand.Next() * 0.35;
            }
            double x = Math.Min(1, Math.Max(0, (strike.Age - 420) / 230));
            double fadeOut = 1 - x * x * (3 - 2 * x);
            return (float)(Math.Min(1.4, f + 0.12 * fadeOut) * fadeOut);
        }
    }
}
