using System;
using UnityEngine;

namespace UwuStack
{
    // Plays a cut-off piece's fall (Fall.cs) on a block: Meshes/Block.fbx
    // with Materials/Block, coloured as the layer it was cut from. Raises
    // Impacted for each knock, landing and splash as the fall reaches it,
    // which is what GameAudio and WaterSurface listen for.
    //
    // Game time runs from Time.time, so the piece falls in real time from
    // when Play() is called.
    public class FallingPiece : MonoBehaviour
    {
        // The water's height now, in game units; the game keeps it up to
        // date, as it decides whether a piece resting on the island shows.
        public double water = Rules.WaterStart;

        public event Action<FallingPiece, Fall.Impact> Impacted;

        public Fall.Result Result { get; private set; }

        float started;
        int nextImpact;

        // fall: from Fall.Simulate(). sx, sz: the piece's size in game
        // units. colour: Palette.Layer() for the layer it was cut from.
        public void Play(Fall.Result fall, double sx, double sz, Color colour)
        {
            Result = fall;
            started = Time.time;
            nextImpact = 0;
            transform.localScale = new Vector3(World.Size(sx), World.Layer, World.Size(sz));
            var block = new MaterialPropertyBlock();
            block.SetColor("_BaseColor", colour);
            GetComponent<Renderer>().SetPropertyBlock(block);
            Update();
        }

        // Game ms now, on the fall's clock.
        public double Now => Result.T0 + (Time.time - started) * 1000.0;

        void Update()
        {
            if (Result == null) return;
            double t = Now;
            while (nextImpact < Result.Impacts.Count && Result.Impacts[nextImpact].T <= t)
            {
                Impacted?.Invoke(this, Result.Impacts[nextImpact]);
                nextImpact++;
            }
            if (!Fall.At(Result, t, water, out Fall.Pose pose))
            {
                Destroy(gameObject);
                return;
            }
            transform.position = World.FromGame(pose.X, pose.Y, pose.Z);
            transform.rotation = World.FromGameRotation(pose.Rx, pose.Rz);
        }
    }
}
