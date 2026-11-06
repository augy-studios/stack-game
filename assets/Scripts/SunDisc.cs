using UnityEngine;

namespace UwuStack
{
    // Draws the sun's disc (Shaders/Sun.shader) over the far water and
    // behind anything solid, as js/scene.js does. Its shader places it on
    // the screen itself, for each camera, from the globals SceneLook sets,
    // so this only makes a quad that is never culled.
    //
    // Put it on any object, with Shaders/Sun.shader in its Shader field.
    // It draws on low quality too, as the web game's does.
    [RequireComponent(typeof(MeshFilter), typeof(MeshRenderer))]
    public class SunDisc : MonoBehaviour
    {
        public Shader shader;   // uwuStack/Sun

        Material material;
        Mesh mesh;

        void OnEnable()
        {
            if (mesh == null)
            {
                mesh = new Mesh { name = "Sun" };
                mesh.vertices = new[]
                {
                    new Vector3(-0.5f, -0.5f, 0), new Vector3(0.5f, -0.5f, 0),
                    new Vector3(-0.5f, 0.5f, 0), new Vector3(0.5f, 0.5f, 0),
                };
                mesh.triangles = new[] { 0, 2, 1, 2, 3, 1 };
                // Placed on the screen by its shader, wherever the camera
                // looks, so it must never be culled.
                mesh.bounds = new Bounds(Vector3.zero, Vector3.one * 1e6f);
            }
            Shader s = shader != null ? shader : Shader.Find("uwuStack/Sun");
            if (material == null && s != null) material = new Material(s) { name = "Sun" };
            GetComponent<MeshFilter>().sharedMesh = mesh;
            MeshRenderer r = GetComponent<MeshRenderer>();
            r.sharedMaterial = material;
            r.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            r.receiveShadows = false;
        }

        void OnDestroy()
        {
            if (material != null) Destroy(material);
            if (mesh != null) Destroy(mesh);
        }
    }
}
