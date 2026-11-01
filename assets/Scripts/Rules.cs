using System;

namespace UwuStack
{
    // The game's numbers, from js/rules.js: sizes, the slab's swing, the
    // water's rise. Integers only, as there, in game units (the base is 1000
    // across, a slab 200 thick) and milliseconds of game time. World.cs
    // turns them into Unity units.
    //
    // Scoring stays in js/rules.js: it is the server's business, and
    // nothing here draws or plays from it.
    public static class Rules
    {
        public const int Base = 1000;
        public const int Layer = 200;

        // How far the moving slab swings either side of the one below it.
        public const int Swing = 1200;

        // The water starts this far below the top of the base, and the
        // island's top sits between the two.
        public const int WaterStart = -1600;
        public const int IslandTop = -1000;

        // speed0, speedStep, speedMax: the slab's speed for layer n is
        //   speed0 + speedStep * (n - 1), up to speedMax, in units a second.
        // perfect: how far off a drop may be and still count as perfect.
        // water0, waterAccel: the water rises at water0 at first, and faster
        //   by waterAccel thousandths a second every second.
        // combo, grow: from this many perfects in a row, each perfect grows
        //   the slab back towards full size by grow units.
        public sealed class Difficulty
        {
            public string Label;
            public int Speed0, SpeedStep, SpeedMax;
            public int Perfect;
            public int Water0, WaterAccel;
            public int Combo, Grow;
        }

        public static readonly Difficulty Easy = new Difficulty
        {
            Label = "Easy", Speed0 = 900, SpeedStep = 10, SpeedMax = 2600, Perfect = 60,
            Water0 = 65, WaterAccel = 900, Combo = 3, Grow = 40,
        };

        public static readonly Difficulty Medium = new Difficulty
        {
            Label = "Medium", Speed0 = 1200, SpeedStep = 14, SpeedMax = 3200, Perfect = 42,
            Water0 = 90, WaterAccel = 1333, Combo = 4, Grow = 30,
        };

        public static readonly Difficulty Hard = new Difficulty
        {
            Label = "Hard", Speed0 = 1600, SpeedStep = 20, SpeedMax = 4000, Perfect = 30,
            Water0 = 125, WaterAccel = 1800, Combo = 5, Grow = 25,
        };

        public static int SpeedFor(Difficulty d, int layer)
        {
            return Math.Min(d.SpeedMax, d.Speed0 + d.SpeedStep * (layer - 1));
        }

        // Where the moving slab is ms after it appeared, as an offset from
        // the slab below it along its axis. It starts Swing behind, and runs
        // back and forth between -Swing and +Swing at speed.
        public static long SwingAt(int speed, long ms)
        {
            long travelled = speed * ms / 1000;
            long phase = travelled % (4 * Swing);
            return phase < 2 * Swing ? -Swing + phase : 3 * Swing - phase;
        }

        // Ms the slab takes to cross from one end of its swing to the other.
        public static long PassMs(int speed)
        {
            return 2L * Swing * 1000 / speed;
        }

        // The water's height at ms into the game. The part that accelerates
        // is worked out a whole second at a time and filled in straight
        // between.
        public static long WaterAt(Difficulty d, long ms)
        {
            long t = Math.Max(0, ms);
            long s = t / 1000;
            Func<long, long> q = x => d.WaterAccel * x * x / 2000;
            long lo = q(s);
            long rise = lo + (q(s + 1) - lo) * (t - s * 1000) / 1000;
            return WaterStart + d.Water0 * t / 1000 + rise;
        }
    }
}
