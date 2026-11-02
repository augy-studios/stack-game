using UnityEngine;

namespace UwuStack
{
    // The cumulus near the tower, from js/scene.js: sixteen camera-facing
    // sprites the wind carries across, at a few heights over the camera's.
    // Each fades in as it comes over the far edge and out as it goes, and
    // out of the way of the tower and the camera, bobbing and billowing a
    // little as it drifts. The sky shader draws the clouds further off.
    //
    // Textures/Cloud.png holds the five cloud shapes js/clouds.js draws,
    // stacked top to bottom; each sprite shows one of them.
    //
    // Put it on an empty object and give it Materials/Cloud. SceneLook sets
    // the material's colour and opacity for the theme; each cloud fades
    // from there.
    public class CloudDrift : MonoBehaviour
    {
        public Material cloudMaterial;
        public TowerCamera rig;

        // Half the clouds, for a slower device.
        public bool lowQuality;

        const int Count = 16;
        const int Variants = 5;
        const float Span = 26f;

        // Along and across the wind, in three.js's axes.
        static readonly Vector2 Wind = new Vector2(0.94f, 0.34f);
        static readonly Vector2 Across = new Vector2(-0.34f, 0.94f);

        struct Cloud
        {
            public Transform transform;
            public MeshRenderer renderer;
            public float along, across, rise, speed, w, h, phase;
        }

        Cloud[] clouds;
        MaterialPropertyBlock block;
        static readonly int BaseColor = Shader.PropertyToID("_BaseColor");

        void Start()
        {
            block = new MaterialPropertyBlock();
            var quads = new Mesh[Variants];
            for (int v = 0; v < Variants; v++) quads[v] = Quad(v);
            clouds = new Cloud[Count];
            for (int i = 0; i < Count; i++)
            {
                // The same seeded numbers as the scene's.
                uint r = (uint)(1013 * (i + 1));
                System.Func<float> rand = () =>
                {
                    r = unchecked(r * 1103515245u + 12345u);
                    return r / 4294967296f;
                };
                rand();
                var go = new GameObject("Cloud");
                go.transform.SetParent(transform, false);
                go.AddComponent<MeshFilter>().sharedMesh = quads[i % Variants];
                var mr = go.AddComponent<MeshRenderer>();
                mr.sharedMaterial = cloudMaterial;
                mr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
                mr.receiveShadows = false;
                float along = rand() * Span * 2 - Span;
                float across = (rand() * 2 - 1) * Span * 0.9f;
                float rise = 0.5f + rand() * 5;
                float speed = 0.25f + rand() * 0.35f;
                float size = 4 + rand() * 4;
                float phase = rand() * 6.28f;
                clouds[i] = new Cloud
                {
                    transform = go.transform,
                    renderer = mr,
                    along = along,
                    across = across,
                    rise = rise,
                    speed = speed,
                    w = size,
                    h = size * 0.5f,
                    phase = phase,
                };
            }
        }

        // A one unit square facing -z showing cloud shape v, so a transform
        // turned as the camera is faces it.
        static Mesh Quad(int v)
        {
            float v0 = 1f - (v + 1f) / Variants;
            float v1 = 1f - (float)v / Variants;
            var mesh = new Mesh { name = "CloudQuad" + v };
            mesh.vertices = new[] { new Vector3(-0.5f, -0.5f, 0), new Vector3(0.5f, -0.5f, 0), new Vector3(-0.5f, 0.5f, 0), new Vector3(0.5f, 0.5f, 0) };
            mesh.uv = new[] { new Vector2(0, v0), new Vector2(1, v0), new Vector2(0, v1), new Vector2(1, v1) };
            mesh.triangles = new[] { 0, 2, 1, 2, 3, 1 };
            mesh.RecalculateBounds();
            return mesh;
        }

        static float Smooth(float x, float a, float b)
        {
            float t = Mathf.Clamp01((x - a) / (b - a));
            return t * t * (3 - 2 * t);
        }

        void LateUpdate()
        {
            Camera cam = rig != null ? rig.GetComponent<Camera>() : Camera.main;
            float camY = rig != null ? rig.FollowY : 0.4f;
            Vector2 centre = rig != null ? rig.Centre : Vector2.zero;
            Color tint = cloudMaterial != null ? cloudMaterial.GetColor(BaseColor) : Color.white;
            float t = Time.time;
            for (int i = 0; i < Count; i++)
            {
                Cloud c = clouds[i];
                bool shown = !lowQuality || i % 2 == 0;
                c.renderer.enabled = shown;
                if (!shown) continue;

                // Along the wind, wrapping round past the far edge.
                float a = Mathf.Repeat(c.along + t * c.speed + Span, 2 * Span) - Span;
                Vector3 offset = World.FromThree(Wind.x * a + Across.x * c.across, 0, Wind.y * a + Across.y * c.across);
                float bob = Mathf.Sin(t * 0.2f + c.phase) * 0.15f;
                c.transform.position = new Vector3(centre.x + offset.x, camY + c.rise + bob, centre.y + offset.z);
                float breathe = 1 + Mathf.Sin(t * 0.13f + c.phase * 2) * 0.05f;
                c.transform.localScale = new Vector3(c.w * breathe, c.h * (2 - breathe), 1);
                if (cam != null) c.transform.rotation = cam.transform.rotation;

                float edge = 1 - Smooth(Mathf.Abs(a), Span * 0.7f, Span);
                float fromTower = new Vector2(offset.x, offset.z).magnitude;
                float fromCamera = cam != null ? Vector3.Distance(c.transform.position, cam.transform.position) : 100f;
                float clear = Smooth(fromTower, 3, 6) * Smooth(fromCamera, c.w, c.w * 2);
                block.SetColor(BaseColor, new Color(tint.r, tint.g, tint.b, tint.a * edge * clear));
                c.renderer.SetPropertyBlock(block);
            }
        }
    }
}
