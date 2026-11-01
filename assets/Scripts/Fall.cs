using System;
using System.Collections.Generic;

namespace UwuStack
{
    // What happens to a piece once it is cut off, from js/fall.js: it tips,
    // falls, knocks against any wider layer below, and splashes into the
    // water, or lands on the island and waits for the water to come for it.
    //
    // Worked out once per piece in fixed steps and kept as frames, so it
    // falls the same way every time, and the impacts come out as a list
    // with times, which is what the sounds play from. Only for show.
    //
    // Everything here is in game units and ms; FallingPiece.cs draws it.
    public static class Fall
    {
        public const int StepMs = 4;
        public const int FrameMs = 16;
        const double Gravity = 9800;
        const int MaxMs = 9000;
        const double IslandRadius = 2300;

        public struct Layer
        {
            public double X, Z, Sx, Sz;
            public Layer(double x, double z, double sx, double sz) { X = x; Z = z; Sx = sx; Sz = sz; }
        }

        // A cut-off piece: where it is, its size, the layer n it was cut
        // from, the axis it was cut along, which way it overhung, and the
        // game ms it was cut.
        public struct Piece
        {
            public double X, Z, Sx, Sz;
            public int N;
            public bool AlongX;
            public int Sign;
            public long T;
        }

        public enum ImpactKind { Slab, Island, Water }

        public struct Impact
        {
            public long T;
            public ImpactKind Kind;
            public double Strength;
        }

        public sealed class Result
        {
            public long T0;
            // x, y, z, rx, rz for every FrameMs.
            public float[] Frames;
            public List<Impact> Impacts;
            public long End;
            // When it came to a stop on the island, the height of its top;
            // otherwise null.
            public double? Rest;
        }

        public struct Pose
        {
            public double X, Y, Z, Rx, Rz;
        }

        // layers: the tower's layers, at least up to piece.N - 1, layer 0
        // being the base. d: the difficulty, for the water.
        public static Result Simulate(Piece piece, IReadOnlyList<Layer> layers, Rules.Difficulty d)
        {
            double x = piece.X;
            double z = piece.Z;
            double y = piece.N * Rules.Layer - Rules.Layer / 2.0;
            bool along = piece.AlongX;
            int sign = piece.Sign != 0 ? piece.Sign : 1;
            // Out over the edge it was cut from, and tipping that way.
            double vx = along ? sign * 260 : 0;
            double vz = along ? 0 : sign * 260;
            double vy = 0;
            double rx = 0;
            double rz = 0;
            double wx = along ? 0 : sign * 2.4;
            double wz = along ? -sign * 2.4 : 0;
            double halfX = piece.Sx / 2;
            double halfZ = piece.Sz / 2;

            var frames = new List<float>();
            var impacts = new List<Impact>();
            bool wet = false;
            double? rest = null;
            int bounces = 0;

            Action push = () =>
            {
                frames.Add((float)x); frames.Add((float)y); frames.Add((float)z);
                frames.Add((float)rx); frames.Add((float)rz);
            };
            push();

            for (int ms = StepMs; ms <= MaxMs; ms += StepMs)
            {
                double dt = StepMs / 1000.0;
                double water = Rules.WaterAt(d, piece.T + ms);
                double bottomBefore = y - Rules.Layer / 2.0;

                if (!wet) vy -= Gravity * dt;
                x += vx * dt;
                z += vz * dt;
                y += vy * dt;
                rx += wx * dt;
                rz += wz * dt;
                double bottom = y - Rules.Layer / 2.0;

                // Any layer whose top it just came down through, and whose
                // footprint it overlaps, stops it and throws it off.
                if (!wet && vy < 0 && bounces < 5)
                {
                    int from = Math.Min(piece.N - 1, (int)Math.Floor(bottomBefore / Rules.Layer));
                    int to = Math.Max(0, (int)Math.Ceiling(bottom / Rules.Layer));
                    for (int k = from; k >= to; k--)
                    {
                        if (k < 0 || k >= layers.Count) continue;
                        Layer layer = layers[k];
                        double top = k * Rules.Layer;
                        if (bottomBefore < top || bottom > top) continue;
                        bool overX = Math.Abs(x - layer.X) < halfX + layer.Sx / 2;
                        bool overZ = Math.Abs(z - layer.Z) < halfZ + layer.Sz / 2;
                        if (!overX || !overZ) continue;
                        impacts.Add(new Impact { T = piece.T + ms, Kind = ImpactKind.Slab, Strength = Math.Min(1, -vy / 4000) });
                        y = top + Rules.Layer / 2.0;
                        vy = -vy * 0.3;
                        // Off the edge it overhangs.
                        if (along) vx = sign * Math.Max(Math.Abs(vx) * 1.3, 700);
                        else vz = sign * Math.Max(Math.Abs(vz) * 1.3, 700);
                        wx *= 1.5;
                        wz *= 1.5;
                        bounces += 1;
                        break;
                    }
                }

                // The island, while it is still above the water.
                bool onIsland = Math.Sqrt(x * x + z * z) < IslandRadius && water < Rules.IslandTop;
                if (!wet && onIsland && y - Rules.Layer / 2.0 <= Rules.IslandTop && vy < 0)
                {
                    impacts.Add(new Impact { T = piece.T + ms, Kind = ImpactKind.Island, Strength = Math.Min(1, -vy / 4000) });
                    y = Rules.IslandTop + Rules.Layer / 2.0;
                    // Math.Floor(v + 0.5) is JavaScript's Math.round.
                    rx = Math.Floor(rx / (Math.PI / 2) + 0.5) * (Math.PI / 2);
                    rz = Math.Floor(rz / (Math.PI / 2) + 0.5) * (Math.PI / 2);
                    push();
                    rest = Rules.IslandTop + Rules.Layer;
                    break;
                }

                if (!wet && y < water)
                {
                    wet = true;
                    impacts.Add(new Impact { T = piece.T + ms, Kind = ImpactKind.Water, Strength = Math.Min(1, -vy / 5000) });
                    vx *= 0.25;
                    vz *= 0.25;
                    vy = -260;
                    wx *= 0.3;
                    wz *= 0.3;
                }

                if (ms % FrameMs == 0) push();
                if (wet && y < water - 3 * Rules.Layer) break;
            }

            int count = frames.Count / 5;
            return new Result
            {
                T0 = piece.T,
                Frames = frames.ToArray(),
                Impacts = impacts,
                End = piece.T + (count - 1) * FrameMs,
                Rest = rest,
            };
        }

        // Where a fallen piece is at game time t, between its frames, or
        // false once it has sunk out of sight. water: the water's height now.
        public static bool At(Result fall, double t, double water, out Pose pose)
        {
            float[] f = fall.Frames;
            int count = f.Length / 5;
            double at = (t - fall.T0) / FrameMs;
            if (at >= count - 1)
            {
                // Resting on the island until the water covers it.
                if (fall.Rest.HasValue && water < fall.Rest.Value)
                {
                    int last = (count - 1) * 5;
                    pose = new Pose { X = f[last], Y = f[last + 1], Z = f[last + 2], Rx = f[last + 3], Rz = f[last + 4] };
                    return true;
                }
                pose = default(Pose);
                return false;
            }
            int i = Math.Max(0, (int)Math.Floor(at));
            double k = at - i;
            int a = i * 5;
            int b = a + 5;
            Func<int, double> mixed = j => f[a + j] + (f[b + j] - f[a + j]) * k;
            pose = new Pose { X = mixed(0), Y = mixed(1), Z = mixed(2), Rx = mixed(3), Rz = mixed(4) };
            return true;
        }
    }
}
