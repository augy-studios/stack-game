using System.Collections.Generic;
using UnityEngine;

namespace UwuStack
{
    // Keeps the sea at the water's height and feeds Shaders/Water.shader
    // what it needs to know of the world, as js/scene.js does each frame:
    // where the shore is, the tower's footprint at the waterline for the
    // foam round it, and the last few places pieces went in, for the rings
    // spreading from them. Splashes.cs reads those too.
    //
    // Put it on the water mesh. The game sets Level (world y) as the water
    // rises, Column when the waterline reaches the tower, and calls
    // AddImpact() when a piece goes in.
    [RequireComponent(typeof(Renderer))]
    public class WaterSurface : MonoBehaviour
    {
        public const int Ripples = 4;
        const float RippleSeconds = 2.5f;

        // The tower camera, whose distance sets where the sea fades out.
        public TowerCamera rig;

        // The water's height, in Unity units.
        public float level = World.FromGame(0, Rules.WaterStart, 0).y;

        public struct Hit
        {
            public Vector2 at;      // world x, z
            public float time;      // Time.time it went in
            public float strength;  // 0 to 1
            public float size;      // the piece's size, world units
            public int seed;        // for its drops, so each splash differs
        }

        // Newest first.
        public readonly List<Hit> hits = new List<Hit>();

        Material material;
        readonly Vector4[] ripples = new Vector4[Ripples];
        Vector4 column = new Vector4(0, 0, -1, -1);

        // The island's grass and sand, as Island.fbx has them.
        const float GrassR = 2.05f;
        const float SandTopR = 2.3f;
        const float SandBottomR = 3.2f;
        const float SandHeight = 3f;
        const float SandTopY = World.IslandTop - 0.06f;
        const float GrassTopY = World.IslandTop + 0.05f;

        void Awake()
        {
            material = GetComponent<Renderer>().sharedMaterial;
        }

        public void AddImpact(Vector3 world, float strength, float size)
        {
            hits.Insert(0, new Hit
            {
                at = new Vector2(world.x, world.z),
                time = Time.time,
                strength = strength,
                size = size,
                seed = Random.Range(0, int.MaxValue),
            });
            if (hits.Count > Ripples) hits.RemoveAt(hits.Count - 1);
        }

        // The tower's footprint where the water meets it: its centre and
        // half sizes in world units. Call with the layer the water has
        // reached, or ClearColumn() while it is below the base.
        public void SetColumn(Vector3 centre, float halfX, float halfZ)
        {
            column = new Vector4(centre.x, centre.z, halfX, halfZ);
        }

        public void ClearColumn()
        {
            column = new Vector4(0, 0, -1, -1);
        }

        // The island's waterline, as a radius of its ten-sided outline, or
        // -1 once the grass is under.
        public static float ShoreRadius(float level)
        {
            if (level >= GrassTopY) return -1;
            if (level >= SandTopY) return GrassR;
            float down = Mathf.Min(SandHeight, SandTopY - level);
            return SandTopR + (SandBottomR - SandTopR) * down / SandHeight;
        }

        void Update()
        {
            Vector3 p = transform.position;
            transform.position = new Vector3(p.x, level, p.z);

            // Below the island's top, the base column is what the water
            // meets.
            Vector4 col = column;
            if (level < GrassTopY) col = new Vector4(0, 0, -1, -1);
            else if (level < 0 && column.z < 0) col = new Vector4(0, 0, 0.5f, 0.5f);

            for (int i = 0; i < Ripples; i++)
            {
                if (i < hits.Count && Time.time - hits[i].time < RippleSeconds)
                {
                    Hit h = hits[i];
                    ripples[i] = new Vector4(h.at.x, h.at.y, Time.time - h.time, 0.4f + 0.6f * h.strength);
                }
                else
                {
                    ripples[i] = new Vector4(0, 0, -1, 0);
                }
            }

            material.SetFloat("_WaterTime", Time.time);
            material.SetFloat("_Level", level);
            material.SetFloat("_Shore", ShoreRadius(level));
            material.SetVector("_Column", col);
            material.SetVectorArray("_Ripples", ripples);
            float dist = rig != null ? rig.Distance : 8f;
            material.SetFloat("_Near", 5 + dist * 0.4f);
            material.SetFloat("_Far", 14 + dist * 1.1f);
        }
    }
}
