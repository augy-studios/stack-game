using UnityEngine;

namespace UwuStack
{
    // Sizes the base column to the difficulty's starting slab, as
    // syncTower() in js/scene.js does: Easy's base is wider than the
    // island's own, Hard's a little narrower. Only its width and depth
    // change; it still runs from the island's top to y = 0.
    //
    // Put it on the Island.fbx instance. It finds the BaseColumn child by
    // name unless one is assigned. Call Apply() whenever a game starts.
    public class BaseColumn : MonoBehaviour
    {
        public Transform column;
        // Optional: told the base's size for the foam round it.
        public WaterSurface water;

        Vector3 fullScale;
        bool ready;

        void Awake()
        {
            Ready();
        }

        bool Ready()
        {
            if (ready) return true;
            if (column == null) column = Find(transform, "BaseColumn");
            if (column == null) return false;
            // Island.fbx's column is Rules.Base across at this scale.
            fullScale = column.localScale;
            ready = true;
            return true;
        }

        public void Apply(Rules.Difficulty d)
        {
            if (!Ready()) return;
            float k = (float)d.Start / Rules.Base;
            column.localScale = new Vector3(fullScale.x * k, fullScale.y, fullScale.z * k);
            if (water != null) water.SetBase(World.Size(d.Start) / 2, World.Size(d.Start) / 2);
        }

        static Transform Find(Transform parent, string name)
        {
            foreach (Transform child in parent)
            {
                if (child.name == name) return child;
                Transform found = Find(child, name);
                if (found != null) return found;
            }
            return null;
        }
    }
}
