using UnityEngine;

namespace UwuStack
{
    // Nine clouds drifting slowly round the island, from js/scene.js: each
    // a camera-facing sprite of Textures/Cloud.png, at one of three
    // distances and sizes, a little higher or lower than the next, and
    // following the camera up as the tower climbs.
    //
    // Put it on an empty object and give it Materials/Cloud. SceneLook sets
    // the clouds' opacity for the theme.
    public class CloudDrift : MonoBehaviour
    {
        public Material cloudMaterial;
        public TowerCamera rig;

        const int Count = 9;

        struct Cloud
        {
            public Transform transform;
            public float angle, radius, rise, speed;
        }

        Cloud[] clouds;

        void Start()
        {
            Mesh quad = Quad();
            clouds = new Cloud[Count];
            for (int i = 0; i < Count; i++)
            {
                var go = new GameObject("Cloud");
                go.transform.SetParent(transform, false);
                go.AddComponent<MeshFilter>().sharedMesh = quad;
                var r = go.AddComponent<MeshRenderer>();
                r.sharedMaterial = cloudMaterial;
                r.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
                r.receiveShadows = false;
                go.transform.localScale = new Vector3(5 + (i % 3) * 1.5f, 2.5f + (i % 3) * 0.75f, 1);
                clouds[i] = new Cloud
                {
                    transform = go.transform,
                    angle = (float)i / Count * Mathf.PI * 2 + 0.4f,
                    radius = 7 + (i % 3) * 3.5f,
                    rise = (i * 37) % 11 - 5,
                    speed = 0.012f + (i % 4) * 0.004f,
                };
            }
        }

        // A one unit square facing -z, so a transform turned as the camera
        // is faces it.
        static Mesh Quad()
        {
            var mesh = new Mesh { name = "CloudQuad" };
            mesh.vertices = new[] { new Vector3(-0.5f, -0.5f, 0), new Vector3(0.5f, -0.5f, 0), new Vector3(-0.5f, 0.5f, 0), new Vector3(0.5f, 0.5f, 0) };
            mesh.uv = new[] { new Vector2(0, 0), new Vector2(1, 0), new Vector2(0, 1), new Vector2(1, 1) };
            mesh.triangles = new[] { 0, 2, 1, 2, 3, 1 };
            mesh.RecalculateBounds();
            return mesh;
        }

        void LateUpdate()
        {
            Camera cam = rig != null ? rig.GetComponent<Camera>() : Camera.main;
            float camY = rig != null ? rig.FollowY : 0.4f;
            foreach (Cloud c in clouds)
            {
                float a = c.angle + Time.time * c.speed;
                c.transform.position = World.FromThree(Mathf.Cos(a) * c.radius, camY + c.rise * 0.6f - 1.5f, Mathf.Sin(a) * c.radius);
                if (cam != null) c.transform.rotation = cam.transform.rotation;
            }
        }
    }
}
