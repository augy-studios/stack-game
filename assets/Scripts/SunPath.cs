using UnityEngine;

namespace UwuStack
{
    // Where the sun is, as js/scene.js's placeSun(): each game's seed turns
    // it round from straight behind the tower and raises or lowers it, and
    // it wanders slowly by the game's own clock, so a replay sees the same
    // sky. The water's glint, the key light and its shadows, the sun's disc
    // (Shaders/Sun.shader), the sky's glow, the god rays and the lens flare
    // (Scripts/GodRays.cs) all follow it.
    //
    // SceneLook calls Place() each frame and sets the shader globals:
    //   _SunGlint  the way to the sun, in Unity's world (Water's _SunDir)
    //   _SunSkyY   how high the sun stands in the flat sky, 0 to 1 up
    //   _SunDisc   how bright its disc and flare are, for the theme and
    //              the weather
    public static class SunPath
    {
        const float Turn = 0.3f;        // radians either side of straight behind, by seed
        const float Wander = 0.12f;     // radians more either side, over Period
        const float Period = 300f;      // seconds

        // The way to the sun for the glint, the rays and the disc.
        public static Vector3 Glint { get; private set; } = World.FromThree(-1f, 0.36f, -1f).normalized;

        // The way to the sun for the key light and its shadows.
        public static Vector3 KeyFrom { get; private set; } = World.FromThree(-2.2f, 5f, 3.4f).normalized;

        // How high the sun stands in the flat sky, 0 to 1 up the screen.
        public static float SkyY { get; private set; } = 0.85f;

        // How bright the disc and the flare are, 0 to 1. SceneLook sets it.
        public static float Disc { get; set; } = 1f;

        // Splashes.Hash() gives [-0.5, 0.5), as the game's hash() does;
        // this wants [0, 1).
        static float U(uint seed, int k)
        {
            return Splashes.Hash(unchecked((int)seed), k) + 0.5f;
        }

        // A direction from js/scene.js turned about its y axis by a, as
        // three.js's applyAxisAngle, then into Unity's world.
        static Vector3 TurnThree(float x, float y, float z, float a)
        {
            float c = Mathf.Cos(a);
            float s = Mathf.Sin(a);
            return World.FromThree(x * c + z * s, y, -x * s + z * c);
        }

        public static void Place(uint seedNum, double gameMs)
        {
            float s = (float)(gameMs / 1000.0);
            float turn = (U(seedNum, 1) * 2f - 1f) * Turn
                + Wander * Mathf.Sin(s / Period * Mathf.PI * 2f + U(seedNum, 2) * Mathf.PI * 2f);
            float high = Mathf.Clamp01(
                U(seedNum, 3) * 0.85f + 0.15f * Mathf.Sin(s / (Period * 1.4f) * Mathf.PI * 2f + U(seedNum, 4) * Mathf.PI * 2f));
            SkyY = 0.78f + 0.14f * high;

            float r = Mathf.Sqrt(0.5f);
            Vector3 g = TurnThree(-r, 0f, -r, turn);
            g.y = Mathf.Tan(0.2f + 0.25f * high);
            Glint = g.normalized;

            Vector3 k = new Vector3(-2.2f, 5f, 3.4f).normalized;
            KeyFrom = TurnThree(k.x, k.y, k.z, turn).normalized;
        }

        // Where the sun lands on a camera's screen, 0 to 1 across and up,
        // which may be off it: across by how far round from the camera's
        // heading it is, a view's width a screen across as the sky's clouds
        // pan; up by its own height. z is how much the camera faces it, 0
        // to 1, 0 once it is behind. As Shaders/Sun.shader's SunScreen().
        public static Vector3 ScreenFor(Camera cam)
        {
            Vector3 heading = cam.transform.forward;
            heading.y = 0;
            if (heading.sqrMagnitude < 1e-6f) heading = Vector3.forward;
            heading.Normalize();
            Vector3 side = Vector3.Cross(Vector3.up, heading);
            float off = Mathf.Atan2(Glint.x * side.x + Glint.z * side.z, Glint.x * heading.x + Glint.z * heading.z);
            float across = 2f * Mathf.Atan(Mathf.Tan(cam.fieldOfView * 0.5f * Mathf.Deg2Rad) * cam.aspect);
            float facing = Mathf.SmoothStep(0f, 1f, Mathf.InverseLerp(0f, 0.6f, Mathf.Cos(off)));
            return new Vector3(0.5f + off / across, SkyY, facing);
        }
    }
}
