using UnityEngine;

namespace UwuStack
{
    // Where a piece goes into the water: a crown of water thrown up round
    // it, and drops flying out of it, from splashes() in js/scene.js. The
    // crown spreads and rises, then falls back; each drop flies out and up
    // and falls back in under gravity, the bigger and harder the piece the
    // higher. The game draws these on high quality only.
    //
    // Reads WaterSurface.hits. Give it Meshes/SplashCrown.fbx and
    // SplashDrop.fbx, and Materials/SplashCrown and SplashDrop.
    public class Splashes : MonoBehaviour
    {
        public WaterSurface water;
        public Mesh crownMesh;
        public Material crownMaterial;
        public Mesh dropMesh;
        public Material dropMaterial;

        const int Drops = 16;
        const float CrownSeconds = 0.6f;
        const float SplashSeconds = 1.1f;

        Transform[] crowns;
        Renderer[] crownRenderers;
        Transform[] drops;
        MaterialPropertyBlock block;

        void Start()
        {
            block = new MaterialPropertyBlock();
            crowns = new Transform[WaterSurface.Ripples];
            crownRenderers = new Renderer[WaterSurface.Ripples];
            for (int i = 0; i < crowns.Length; i++)
            {
                crowns[i] = Part("Crown", crownMesh, crownMaterial);
                crownRenderers[i] = crowns[i].GetComponent<Renderer>();
            }
            drops = new Transform[WaterSurface.Ripples * Drops];
            for (int i = 0; i < drops.Length; i++) drops[i] = Part("Drop", dropMesh, dropMaterial);
        }

        Transform Part(string name, Mesh mesh, Material material)
        {
            var go = new GameObject(name);
            go.transform.SetParent(transform, false);
            go.AddComponent<MeshFilter>().sharedMesh = mesh;
            var r = go.AddComponent<MeshRenderer>();
            r.sharedMaterial = material;
            r.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            r.receiveShadows = false;
            go.SetActive(false);
            return go.transform;
        }

        // A repeatable number from two integers, so a splash throws the same
        // drops every frame. As the game's hash() in js/scene.js: its last
        // step leaves a signed integer, so the number is in [-0.5, 0.5),
        // not the [0, 1) its comment says, and drops come out as the game
        // throws them only if this does the same.
        public static float Hash(int a, int b)
        {
            uint x = (uint)(a ^ (int)((uint)(b + 1) * 0x9e3779b1u)) * 0x85ebca6bu;
            x ^= x >> 13;
            x *= 0xc2b2ae35u;
            x ^= x >> 16;
            return (int)x / 4294967296f;
        }

        void Update()
        {
            int used = 0;
            Color foam = water.GetComponent<Renderer>().sharedMaterial.GetColor("_FoamColor");
            for (int i = 0; i < WaterSurface.Ripples; i++)
            {
                bool on = i < water.hits.Count && Time.time - water.hits[i].time < SplashSeconds;
                WaterSurface.Hit h = on ? water.hits[i] : default(WaterSurface.Hit);
                float age = Time.time - h.time;
                bool crownOn = on && age < CrownSeconds;
                crowns[i].gameObject.SetActive(crownOn);
                if (!on) continue;

                float big = (0.5f + 0.5f * h.strength) * Mathf.Min(1.4f, 0.5f + h.size);
                if (crownOn)
                {
                    float k = age / CrownSeconds;
                    float r = h.size * 0.45f + k * 0.5f * big;
                    crowns[i].position = new Vector3(h.at.x, water.level, h.at.y);
                    crowns[i].localScale = new Vector3(r, 0.55f * big * Mathf.Sin(Mathf.PI * Mathf.Min(1, k * 1.3f)) + 0.001f, r);
                    block.SetColor("_BaseColor", new Color(foam.r, foam.g, foam.b, 0.8f * (1 - k)));
                    crownRenderers[i].SetPropertyBlock(block);
                }

                for (int j = 0; j < Drops; j++)
                {
                    float up = (1.9f + 1.4f * Hash(h.seed, j * 4 + 2)) * big;
                    float y = up * age - 4.9f * age * age;
                    if (y < -0.02f) continue;
                    float a = (float)j / Drops * Mathf.PI * 2 + Hash(h.seed, j * 4) * 0.5f;
                    float outward = h.size * 0.4f + (0.35f + 0.5f * Hash(h.seed, j * 4 + 1)) * big * age;
                    Transform drop = drops[used++];
                    drop.gameObject.SetActive(true);
                    drop.position = new Vector3(h.at.x + Mathf.Cos(a) * outward, water.level + y, h.at.y + Mathf.Sin(a) * outward);
                    drop.localScale = Vector3.one * (0.022f + 0.026f * Hash(h.seed, j * 4 + 3)) * big;
                }
            }
            for (int i = used; i < drops.Length; i++) drops[i].gameObject.SetActive(false);
        }
    }
}
