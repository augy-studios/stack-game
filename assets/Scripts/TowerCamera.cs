using UnityEngine;

namespace UwuStack
{
    // The game's camera, from js/scene.js: up and off to one side of the
    // tower, looking down at its top, and far enough back to show a column
    // about four units wide and five and a half tall whatever the screen's
    // shape. It eases after the top layer as the tower climbs and wanders,
    // and can pull back to show the whole tower (overview), or be turned,
    // tilted, zoomed and lifted by a free camera (orbit).
    //
    // Put it on the Camera. The game calls Follow() whenever a layer lands
    // or the water rises.
    [RequireComponent(typeof(Camera))]
    public class TowerCamera : MonoBehaviour
    {
        const float Fov = 40f;

        // 0 follows the top; 1 pulls back to show the whole tower.
        [Range(0, 1)] public float overview;

        // A free camera's offsets: radians round and up, a zoom factor,
        // and a lift in screen heights. Zero, zero, one, zero is the
        // game's own view.
        public float yaw, pitch, zoom = 1, lift;

        // Set Unity's linear fog to follow the camera's distance, as the
        // scene does.
        public bool driveFog = true;

        // How far the camera sits from what it looks at, after easing.
        public float Distance { get; private set; } = 8f;

        // The height it follows, after easing: the top layer and a bit.
        public float FollowY { get; private set; } = 0.4f;

        Camera cam;
        float top;
        Vector2 topXZ;
        float waterY = World.FromGame(0, Rules.WaterStart, 0).y;
        float x, z;
        float oYaw, oPitch, oZoom = 1, oLift;
        bool ready;

        // The camera's usual direction from the tower, mirrored as World.cs
        // mirrors everything.
        static readonly Vector3 Dir = World.FromThree(1, 0.62f, 1).normalized;
        static readonly float BaseRise = Mathf.Asin(Dir.y);
        static readonly float BaseRound = Mathf.Atan2(Dir.x, Dir.z);

        void Awake()
        {
            cam = GetComponent<Camera>();
            cam.fieldOfView = Fov;
            cam.nearClipPlane = 0.05f;
            cam.farClipPlane = 400f;
        }

        // count: layers standing, the base included. topCentre: the top
        // layer's centre (x, z) in world units. water: its height in world
        // units.
        public void Follow(int count, Vector2 topCentre, float water)
        {
            top = (count - 1) * World.Layer;
            topXZ = topCentre;
            waterY = water;
        }

        // Jumps straight to where it is going, for a new game.
        public void Snap()
        {
            ready = false;
        }

        void LateUpdate()
        {
            float dt = Time.deltaTime;
            float t = Mathf.Tan(Fov / 2 * Mathf.Deg2Rad);
            float fit = Mathf.Max(5.4f / (2 * t), 4.0f / (2 * t * cam.aspect));
            float tall = top - Mathf.Max(waterY, World.IslandTop) + 2.4f;
            float backFor = tall / (2 * t) * 1.1f;
            float wantDist = fit + (Mathf.Max(fit, backFor) - fit) * overview;
            float wantY = top + 0.55f - (top / 2 + 0.2f) * overview;
            if (!ready)
            {
                FollowY = wantY;
                x = topXZ.x;
                z = topXZ.y;
                Distance = wantDist;
                oYaw = yaw; oPitch = pitch; oZoom = zoom; oLift = lift;
                ready = true;
            }
            float ease = 1 - Mathf.Exp(-dt * 4);
            FollowY += (wantY - FollowY) * ease;
            x += (topXZ.x - x) * ease;
            z += (topXZ.y - z) * ease;
            Distance += (wantDist - Distance) * ease;

            float glide = 1 - Mathf.Exp(-dt * 12);
            oYaw += Mathf.DeltaAngle(oYaw * Mathf.Rad2Deg, yaw * Mathf.Rad2Deg) * Mathf.Deg2Rad * glide;
            oPitch += (pitch - oPitch) * glide;
            oZoom += (zoom - oZoom) * glide;
            oLift += (lift - oLift) * glide;

            float dist = Distance * oZoom;
            float screen = 2 * t * dist;
            // Lifted no further than from the island to just over the top.
            float lo = World.IslandTop - 0.5f;
            float hi = Mathf.Max(lo, top + 1);
            float ty = Mathf.Clamp(FollowY + oLift * screen, lo, hi);
            float rise = BaseRise + oPitch;
            float round = BaseRound + oYaw;
            var look = new Vector3(Mathf.Cos(rise) * Mathf.Sin(round), Mathf.Sin(rise), Mathf.Cos(rise) * Mathf.Cos(round));

            // Lower down the tower, nearer the base's centre, so the whole
            // tower in view sits in the middle too.
            float along = top > 0 ? Mathf.Clamp01(ty / top) : 0;
            var target = new Vector3(x * along, ty, z * along);
            transform.position = target + look * dist;
            transform.LookAt(target);

            if (driveFog)
            {
                RenderSettings.fogStartDistance = dist * 2.5f;
                RenderSettings.fogEndDistance = dist * 9 + 30;
            }
        }
    }
}
