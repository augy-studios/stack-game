using UnityEngine;

namespace UwuStack
{
    // From the game's numbers to Unity's world.
    //
    // The game (js/rules.js) works in units where the tower's base is 1000
    // across and a layer 200 tall; its scene draws a thousandth of that, so
    // the base is one Unity unit across. The top of the base column is
    // y = 0 and the island's top y = -1.
    //
    // three.js is right handed and Unity left handed. Unity's FBX importer
    // mirrors x to get from one to the other, so everything in Meshes/
    // arrives mirrored in x. These do the same to the game's numbers, so the
    // tower, the pieces and the island all line up.
    public static class World
    {
        public const float Scale = 1f / 1000f;

        // A layer's height in Unity units.
        public const float Layer = Rules.Layer * Scale;

        // The island's top, in Unity units.
        public const float IslandTop = Rules.IslandTop * Scale;

        // A point in game units.
        public static Vector3 FromGame(double x, double y, double z)
        {
            return new Vector3((float)(-x * Scale), (float)(y * Scale), (float)(z * Scale));
        }

        // A distance in game units, unsigned, such as a slab's width.
        public static float Size(double units)
        {
            return (float)(units * Scale);
        }

        // A direction or point from js/scene.js, which is already in its
        // own world units.
        public static Vector3 FromThree(float x, float y, float z)
        {
            return new Vector3(-x, y, z);
        }

        // A falling piece's turn, which the scene sets as
        // rotation.set(rx, 0, rz) in three.js's XYZ order. Mirroring x keeps
        // the turn about x and reverses the one about z.
        public static Quaternion FromGameRotation(double rx, double rz)
        {
            return Quaternion.AngleAxis((float)(rx * Mathf.Rad2Deg), Vector3.right)
                 * Quaternion.AngleAxis((float)(-rz * Mathf.Rad2Deg), Vector3.forward);
        }
    }
}
