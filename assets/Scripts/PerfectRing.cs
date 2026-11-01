using UnityEngine;

namespace UwuStack
{
    // The ring a perfect drop leaves, from js/scene.js: a white frame round
    // the layer and a plate of its colour, washed with white, under it, both
    // spreading out and fading over 0.65 s. Bigger when the perfect also
    // grew the layer back.
    //
    // Make a prefab with this on it and two children: Meshes/
    // PerfectRingFrame.fbx with Materials/PerfectRingFrame, and
    // PerfectRingPlate.fbx with Materials/PerfectRingPlate. Instantiate it
    // and call Play(); it removes itself when done.
    public class PerfectRing : MonoBehaviour
    {
        public Renderer frame;
        public Renderer plate;

        const float Seconds = 0.65f;

        float started;
        float sx, sz;
        bool big;
        Color plateColour;
        MaterialPropertyBlock block;

        // top: the centre of the layer's top face, in world units. sx, sz:
        // the layer's size. layerColour: Palette.Layer() for it.
        public void Play(Vector3 top, float sx, float sz, Color layerColour, bool big)
        {
            this.sx = sx;
            this.sz = sz;
            this.big = big;
            plateColour = Palette.RingPlate(layerColour);
            started = Time.time;
            frame.transform.position = top + new Vector3(0, 0.002f, 0);
            plate.transform.position = top + new Vector3(0, 0.001f, 0);
            block = new MaterialPropertyBlock();
            Update();
        }

        void Update()
        {
            if (block == null) return;
            float age = (Time.time - started) / Seconds;
            if (age >= 1)
            {
                Destroy(gameObject);
                return;
            }
            float grow = 1.08f + age * (big ? 0.55f : 0.35f);
            frame.transform.localScale = new Vector3(sx * grow, 1, sz * grow);
            plate.transform.localScale = new Vector3(sx * (grow + 0.12f), 1, sz * (grow + 0.12f));
            block.SetColor("_BaseColor", new Color(1, 1, 1, 0.95f * (1 - age)));
            frame.SetPropertyBlock(block);
            block.SetColor("_BaseColor", new Color(plateColour.r, plateColour.g, plateColour.b, 0.32f * (1 - age)));
            plate.SetPropertyBlock(block);
        }
    }
}
