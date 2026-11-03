using System;
using System.Collections.Generic;

namespace UwuStack
{
    // What a saved picture's caption says about the game, from the game.
    public class ShotInfo
    {
        // The player's name, or empty: the score takes its place.
        public string Name = "";
        public int Score, High, Perfects, BestRun;
        // The difficulty's label: "Easy", "Medium" or "Hard".
        public string Mode = "";
        public string Seed = "";
        // Autoplay played any of it.
        public bool Auto;
        // When the game was played, in UTC, or null when nobody knows: the
        // date is then left off.
        public DateTime? PlayedAt;
    }

    // The band along the bottom of a saved picture, from js/shot.js: what
    // it says and where every piece of it goes. Plain C#, no Unity, so the
    // layout can be checked anywhere; TowerScreenshot draws it.
    //
    // Everything is sized from the picture's shorter side, so it reads the
    // same on a wide 4K picture and a tall phone one. A line too long for
    // the width is set smaller rather than cut. On a picture too narrow for
    // the corner (the icon, uwuStack and the address) beside the words, the
    // corner drops to its own row under them.
    //
    // Pixels run from the picture's top left, y down, as on the web.
    public static class ShotCaption
    {
        public const string Brand = "uwuStack";

        static readonly string[] Months = { "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec" };

        // Day, month, year, the month short and in English like the rest
        // of the game: "3 Nov 2026".
        public static string PlayedOn(DateTime local)
        {
            return local.Day + " " + Months[local.Month - 1] + " " + local.Year;
        }

        public enum Ink { Brand, Text, Muted }

        // Words on one line. Parts are joined by a separator dot, drawn
        // rather than typed: the game's font has no dot of its own.
        public struct Run
        {
            public string[] Parts;
            public int Size;
            public float X, Baseline;
            public Ink Ink;
        }

        public class Plan
        {
            public int Width, Height;
            public float Scale;
            public int BandTop, BandHeight;
            public readonly List<Run> Runs = new List<Run>();
            public bool HasIcon;
            public float IconX, IconY, IconSize;
        }

        // The width of the space between two parts, dot and all.
        public static float Separator(int size) => size * 0.9f;

        // The dot's centre from the start of its separator and from the
        // baseline (up), and its diameter.
        public static float DotX(int size) => Separator(size) / 2;
        public static float DotRise(int size) => size * 0.32f;
        public static float DotSize(int size) => Math.Max(1f, size * 0.16f);

        public static float Width(string[] parts, int size, Func<string, int, float> measure)
        {
            float w = 0;
            for (int i = 0; i < parts.Length; i++) w += measure(parts[i], size);
            return w + Math.Max(0, parts.Length - 1) * Separator(size);
        }

        // The words, top to bottom: the name, or the score without one; the
        // result; the seed and the day.
        public static string[][] Lines(ShotInfo info)
        {
            string points = info.Score + (info.Score == 1 ? " point" : " points");
            bool named = !string.IsNullOrWhiteSpace(info.Name);
            var result = new List<string>();
            if (named) result.Add(points);
            result.Add(info.High + " high");
            result.Add(info.Mode + " mode");
            result.Add(info.Perfects + " perfect");
            result.Add("best run " + info.BestRun);
            if (info.Auto) result.Add("autoplay");
            var detail = new List<string> { "Seed " + info.Seed };
            if (info.PlayedAt.HasValue) detail.Add(PlayedOn(info.PlayedAt.Value.ToLocalTime()));
            return new[] { new[] { named ? info.Name.Trim() : points }, result.ToArray(), detail.ToArray() };
        }

        static int R(float v) => (int)Math.Round(v, MidpointRounding.AwayFromZero);

        // A size at which the parts fit in room: the size asked for, or
        // smaller.
        static int Fit(string[] parts, int size, float room, Func<string, int, float> measure)
        {
            float w = Width(parts, size, measure);
            return w <= room ? size : Math.Max(1, (int)Math.Floor(size * room / w));
        }

        // measure(text, size): the width of text at a font size, in pixels.
        public static Plan Lay(int W, int H, ShotInfo info, string address, bool icon, Func<string, int, float> measure)
        {
            float u = Math.Min(W, H) / 1080f;
            int titleSize = R(50 * u), resultSize = R(31 * u), detailSize = R(25 * u), brandSize = R(40 * u);
            int pad = R(34 * u), gap = R(30 * u), iconSize = R(76 * u), iconGap = R(18 * u);
            address = address ?? "";

            string[][] lines = Lines(info);
            float brandW = measure(Brand, brandSize);
            float hostW = address.Length > 0 ? measure(address, detailSize) : 0;
            float cornerW = (icon ? iconSize + iconGap : 0) + Math.Max(brandW, hostW);
            float wordsW = Math.Max(Width(lines[0], titleSize, measure), Width(lines[1], resultSize, measure));
            bool beside = pad * 2 + wordsW + gap + cornerW <= W;
            float room = beside ? W - pad * 2 - gap - cornerW : W - pad * 2;

            int[] sizes = { Fit(lines[0], titleSize, room, measure), Fit(lines[1], resultSize, room, measure), Fit(lines[2], detailSize, room, measure) };
            var inks = new[] { Ink.Brand, Ink.Text, Ink.Muted };

            const float lead = 1.32f;
            float wordsH = sizes[0] * lead + sizes[1] * lead + sizes[2] * lead - sizes[2] * (lead - 1);
            int footH = beside ? 0 : R(detailSize * 1.9f);
            int bandH = R(pad * 2 + Math.Max(wordsH, beside ? iconSize : 0) + footH);
            int top = H - bandH;

            var plan = new Plan { Width = W, Height = H, Scale = u, BandTop = top, BandHeight = bandH };
            float y = top + pad + (beside ? Math.Max(0, (iconSize - wordsH) / 2) : 0);
            for (int i = 0; i < 3; i++)
            {
                plan.Runs.Add(new Run { Parts = lines[i], Size = sizes[i], X = pad, Baseline = y + sizes[i] * 0.88f, Ink = inks[i] });
                y += sizes[i] * lead;
            }

            if (beside)
            {
                float right = W - pad;
                float textX = right - Math.Max(brandW, hostW);
                float mid = top + bandH / 2f;
                if (icon)
                {
                    plan.HasIcon = true;
                    plan.IconSize = iconSize;
                    plan.IconX = textX - iconGap - iconSize;
                    plan.IconY = mid - iconSize / 2f;
                }
                plan.Runs.Add(new Run { Parts = new[] { Brand }, Size = brandSize, X = right - brandW, Baseline = mid - R(4 * u), Ink = Ink.Brand });
                if (address.Length > 0)
                    plan.Runs.Add(new Run { Parts = new[] { address }, Size = detailSize, X = right - hostW, Baseline = mid + detailSize * 1.1f, Ink = Ink.Muted });
            }
            else
            {
                // Its own row: a small icon, then "uwuStack · the address".
                float rowY = H - pad;
                int small = R(detailSize * 1.3f);
                float x = pad;
                if (icon)
                {
                    plan.HasIcon = true;
                    plan.IconSize = small;
                    plan.IconX = x;
                    plan.IconY = rowY - small + detailSize * 0.2f;
                    x += small + R(12 * u);
                }
                plan.Runs.Add(new Run { Parts = new[] { Brand }, Size = detailSize, X = x, Baseline = rowY, Ink = Ink.Brand });
                if (address.Length > 0)
                {
                    float after = x + measure(Brand, detailSize);
                    plan.Runs.Add(new Run { Parts = new[] { "", address }, Size = detailSize, X = after, Baseline = rowY, Ink = Ink.Muted });
                }
            }
            return plan;
        }
    }
}
