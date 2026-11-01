using UnityEngine;

namespace UwuStack
{
    // A layer a run of perfects grew pushes its new side out, easing to a
    // stop, rather than appearing full size, from growLayers() in
    // js/scene.js. It takes 0.67 s, as long as the slide in
    // Audio/Grow.wav played at GameAudio's pitch, so the two end together.
    //
    // Put it on a layer already at its new, full size, then call Grow():
    // the side starts amount short and eases out with a cubic ease-out.
    public class LayerGrow : MonoBehaviour
    {
        public const float Seconds = 0.67f;

        Vector3 fullScale, fullPosition, outward;
        float amount, started;
        bool growing;

        // outward: the world direction the side grows towards, along x or
        // z. amount: how far it grows, in world units.
        public void Grow(Vector3 outward, float amount)
        {
            this.outward = outward.normalized;
            this.amount = amount;
            fullScale = transform.localScale;
            fullPosition = transform.position;
            started = Time.time;
            growing = true;
            Update();
        }

        // How much of the side is still missing, p from 0 to 1 of the way.
        public static float Missing(float amount, float p)
        {
            float left = 1 - Mathf.Clamp01(p);
            return amount * left * left * left;
        }

        void Update()
        {
            if (!growing) return;
            float p = (Time.time - started) / Seconds;
            float missing = Missing(amount, p);
            Vector3 axis = new Vector3(Mathf.Abs(outward.x), 0, Mathf.Abs(outward.z));
            transform.localScale = fullScale - axis * missing;
            transform.position = fullPosition - outward * (missing / 2);
            if (p >= 1)
            {
                transform.localScale = fullScale;
                transform.position = fullPosition;
                growing = false;
            }
        }
    }
}
