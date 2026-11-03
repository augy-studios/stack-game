using System;
using System.IO;
using System.Runtime.InteropServices;
using UnityEngine;
using UnityEngine.Rendering;
#if ENABLE_INPUT_SYSTEM
using UnityEngine.InputSystem;
#endif

namespace UwuStack
{
    // A saved picture of the tower, from the web game's camera button
    // (js/game.js, js/shot.js): the camera's view drawn again at 4K with
    // no UI over it, a band along the bottom naming the player and the
    // game, then saved as a PNG.
    //
    // Put it on the Camera, beside TowerCamera, and fill in Font with
    // Fonts/Jua-Regular.ttf and Icon with Icons/App/RST-192.png. Call
    // Take(info) from the replay bar's camera button (Icons/UI/Camera.png).
    // P takes one too, while Hotkey is on, with whatever CurrentInfo gives:
    // turn Hotkey off while a text field has the keyboard.
    //
    // Size: 3840 pixels along the longer side, whatever the screen, held
    // to 4K UHD's pixel count in all, and to 6 megapixels on a phone, as
    // the web game does, to spare GPU memory. Never smaller than the screen.
    //
    // Where it goes: the user's Downloads folder on Windows, macOS and
    // Linux; a browser download in a WebGL build (Plugins/WebGL/
    // TowerScreenshot.jslib); on Android and iOS, a Screenshots folder in
    // the app's own storage, since the photo gallery needs a native plugin.
    [RequireComponent(typeof(Camera))]
    public class TowerScreenshot : MonoBehaviour
    {
        public const int LongSide = 3840;
        public const long MaxPixels = 3840L * 2160L;
        public const long MaxPixelsMobile = 6000000L;

        // Fonts/Jua-Regular.ttf, imported as a dynamic Font. Unity's own
        // font stands in when it is empty.
        public Font font;

        // Icons/App/RST-192.png, for the corner. Left out when empty.
        public Texture icon;

        // Light or dark, from its dark switch. Light when empty.
        public SceneLook sceneLook;

        // The site's address, under uwuStack in the corner. Empty leaves it
        // off.
        public string address = "stack.uwuapps.org";

        // P takes a picture.
        public bool hotkey = true;

        // What P's picture says. Null, or nothing set, gives a picture
        // with no band.
        public Func<ShotInfo> CurrentInfo;

        // After each save: where it went (a path, or the file name in a
        // browser), and the picture's width and height.
        public event Action<string, int, int> Saved;

        Camera cam;
        Material fill;
        Texture2D dot;
        Font asking;
        bool rebuilt;

        // The theme's colours, from css/theme.css's classic theme.
        static readonly Color InkLight = new Color32(0x12, 0x18, 0x15, 255);
        static readonly Color MutedLight = new Color32(0x5b, 0x66, 0x5f, 255);
        static readonly Color BrandLight = new Color32(0x1f, 0x6b, 0x3d, 255);
        static readonly Color InkDark = new Color32(0xee, 0xf2, 0xef, 255);
        static readonly Color MutedDark = new Color32(0x9a, 0xa7, 0xa0, 255);
        static readonly Color BrandDark = new Color32(0xbf, 0xf5, 0xcf, 255);
        static readonly Color WashLight = new Color(1, 1, 1, 0.66f);
        static readonly Color WashDark = new Color32(12, 16, 14, 158);
        static readonly Color EdgeLight = new Color(1, 1, 1, 0.85f);
        static readonly Color EdgeDark = new Color(1, 1, 1, 0.14f);

        void Awake()
        {
            cam = GetComponent<Camera>();
        }

        void OnDestroy()
        {
            if (fill) Destroy(fill);
            if (dot) Destroy(dot);
        }

        void Update()
        {
            if (hotkey && PressedP()) Take(CurrentInfo?.Invoke());
        }

        static bool PressedP()
        {
#if ENABLE_INPUT_SYSTEM
            return Keyboard.current != null && Keyboard.current.pKey.wasPressedThisFrame;
#else
            return Input.GetKeyDown(KeyCode.P);
#endif
        }

        // Takes and saves a picture. Returns where it went, or null if it
        // could not be made. info null leaves the band off.
        public string Take(ShotInfo info)
        {
            if (!cam) cam = GetComponent<Camera>();
            Vector2Int size = SizeFor(cam.pixelWidth, cam.pixelHeight);
            var rt = new RenderTexture(size.x, size.y, 24, RenderTextureFormat.ARGB32, RenderTextureReadWrite.sRGB);
            rt.Create();
            Texture2D pixels = null;
            RenderTexture before = RenderTexture.active;
            try
            {
                // The band is laid out first, so the camera can be framed
                // above it. No font at all, which Unity should never be
                // without, still saves the picture, just without its band.
                ShotCaption.Plan plan = info != null && Face
                    ? ShotCaption.Lay(size.x, size.y, info, address, icon != null, Measure)
                    : null;
                Render(rt, plan != null ? plan.BandHeight / (float)size.y : 0);
                if (plan != null) Caption(rt, plan);
                pixels = new Texture2D(size.x, size.y, TextureFormat.RGB24, false);
                RenderTexture.active = rt;
                pixels.ReadPixels(new Rect(0, 0, size.x, size.y), 0, 0, false);
                pixels.Apply(false);
                string where = Save(pixels.EncodeToPNG(), FileName());
                Saved?.Invoke(where, size.x, size.y);
                return where;
            }
            catch (Exception e)
            {
                Debug.LogException(e, this);
                return null;
            }
            finally
            {
                RenderTexture.active = before;
                rt.Release();
                Destroy(rt);
                if (pixels) Destroy(pixels);
            }
        }

        public static Vector2Int SizeFor(int w, int h)
        {
            w = Mathf.Max(1, w);
            h = Mathf.Max(1, h);
            int side = Mathf.Max(w, h);
            long cap = Application.isMobilePlatform ? MaxPixelsMobile : MaxPixels;
            float ratio = Mathf.Min(
                Mathf.Min(LongSide / (float)side, Mathf.Sqrt(cap / ((float)w * h))),
                SystemInfo.maxTextureSize / (float)side);
            ratio = Mathf.Max(1f, ratio);
            return new Vector2Int(Mathf.FloorToInt(w * ratio), Mathf.FloorToInt(h * ratio));
        }

        // The camera's view into rt, with post-processing, and without any
        // canvas on the UI layer: overlay canvases are never drawn by a
        // camera, and a camera-space one would be.
        //
        // band is the share of the picture's height the caption covers. All
        // of what the player sees goes above it: the view keeps its top edge
        // and widens down and to the sides, so nothing they framed is hidden
        // behind the words and nobody has to frame round them.
        void Render(RenderTexture rt, float band)
        {
            int mask = cam.cullingMask;
            int ui = LayerMask.NameToLayer("UI");
            if (ui >= 0) cam.cullingMask = mask & ~(1 << ui);
            bool framed = band > 0 && !cam.orthographic;
            if (framed)
            {
                float t = cam.nearClipPlane * Mathf.Tan(cam.fieldOfView * 0.5f * Mathf.Deg2Rad);
                ShotCaption.Frustum(t, t * cam.aspect, band, out float l, out float r, out float b, out float top);
                cam.projectionMatrix = Matrix4x4.Frustum(l, r, b, top, cam.nearClipPlane, cam.farClipPlane);
            }
            try
            {
                var request = new RenderPipeline.StandardRequest { destination = rt };
                if (RenderPipeline.SupportsRenderRequest(cam, request))
                {
                    RenderPipeline.SubmitRenderRequest(cam, request);
                }
                else
                {
                    RenderTexture target = cam.targetTexture;
                    cam.targetTexture = rt;
                    cam.Render();
                    cam.targetTexture = target;
                }
            }
            finally
            {
                cam.cullingMask = mask;
                if (framed) cam.ResetProjectionMatrix();
            }
        }

        /* ---- the band ---- */

        Font Face => font ? font : Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");

        float Measure(string text, int size)
        {
            if (string.IsNullOrEmpty(text)) return 0;
            Font f = Face;
            f.RequestCharactersInTexture(text, size);
            float w = 0;
            foreach (char ch in text)
                if (f.GetCharacterInfo(ch, out CharacterInfo c, size)) w += c.advance;
            return w;
        }

        void Caption(RenderTexture rt, ShotCaption.Plan plan)
        {
            Font f = Face;

            // Every character first: asking for more can rebuild the font's
            // texture, which moves the ones already asked for. Again if it did.
            asking = f;
            Font.textureRebuilt += Rebuilt;
            try
            {
                for (int tries = 0; tries < 3; tries++)
                {
                    rebuilt = false;
                    foreach (ShotCaption.Run run in plan.Runs)
                        foreach (string part in run.Parts)
                            if (part.Length > 0) f.RequestCharactersInTexture(part, run.Size);
                    if (!rebuilt) break;
                }
            }
            finally
            {
                Font.textureRebuilt -= Rebuilt;
            }

            bool dark = sceneLook != null && sceneLook.dark;
            EnsureTools();
            RenderTexture.active = rt;
            GL.PushMatrix();
            GL.LoadPixelMatrix(0, rt.width, rt.height, 0);
            // The scene's depth stays in rt; nothing here should test against it.
            GL.Clear(true, false, Color.clear);
            try
            {
                Frost(rt, plan);
                RenderTexture.active = rt;
                GL.LoadPixelMatrix(0, rt.width, rt.height, 0);
                Quad(Texture2D.whiteTexture, dark ? WashDark : WashLight, 0, plan.BandTop, rt.width, rt.height);
                Quad(Texture2D.whiteTexture, dark ? EdgeDark : EdgeLight, 0, plan.BandTop, rt.width, plan.BandTop + Mathf.Max(1, Mathf.Round(2 * plan.Scale)));
                if (plan.HasIcon)
                    Quad(icon, Color.white, plan.IconX, plan.IconY, plan.IconX + plan.IconSize, plan.IconY + plan.IconSize);
                foreach (ShotCaption.Run run in plan.Runs) DrawRun(f, run, InkFor(run.Ink, dark));
            }
            finally
            {
                GL.PopMatrix();
            }
        }

        void Rebuilt(Font changed)
        {
            if (changed == asking) rebuilt = true;
        }

        static Color InkFor(ShotCaption.Ink ink, bool dark)
        {
            switch (ink)
            {
                case ShotCaption.Ink.Brand: return dark ? BrandDark : BrandLight;
                case ShotCaption.Ink.Muted: return dark ? MutedDark : MutedLight;
                default: return dark ? InkDark : InkLight;
            }
        }

        // Frosted glass: the band of the picture shrunk to a 32nd and drawn
        // back up over itself, which blurs it about as much as the web
        // game's blur does.
        void Frost(RenderTexture rt, ShotCaption.Plan plan)
        {
            int w8 = Mathf.Max(1, rt.width / 8), h8 = Mathf.Max(1, plan.BandHeight / 8);
            int w32 = Mathf.Max(1, rt.width / 32), h32 = Mathf.Max(1, plan.BandHeight / 32);
            RenderTexture eighth = RenderTexture.GetTemporary(w8, h8, 0, RenderTextureFormat.ARGB32, RenderTextureReadWrite.sRGB);
            RenderTexture tiny = RenderTexture.GetTemporary(w32, h32, 0, RenderTextureFormat.ARGB32, RenderTextureReadWrite.sRGB);
            eighth.filterMode = FilterMode.Bilinear;
            tiny.filterMode = FilterMode.Bilinear;
            try
            {
                // Texture coordinates run from the bottom: the band is v 0
                // to its share of the height.
                float v = plan.BandHeight / (float)rt.height;
                RenderTexture.active = eighth;
                GL.LoadPixelMatrix(0, w8, h8, 0);
                Quad(rt, Color.white, 0, 0, w8, h8, v, 0);
                RenderTexture.active = tiny;
                GL.LoadPixelMatrix(0, w32, h32, 0);
                Quad(eighth, Color.white, 0, 0, w32, h32, 1, 0);
                RenderTexture.active = rt;
                GL.LoadPixelMatrix(0, rt.width, rt.height, 0);
                Quad(tiny, Color.white, 0, plan.BandTop, rt.width, rt.height, 1, 0);
            }
            finally
            {
                RenderTexture.ReleaseTemporary(eighth);
                RenderTexture.ReleaseTemporary(tiny);
            }
        }

        void DrawRun(Font f, ShotCaption.Run run, Color colour)
        {
            float x = run.X;
            for (int i = 0; i < run.Parts.Length; i++)
            {
                if (i > 0)
                {
                    float d = ShotCaption.DotSize(run.Size);
                    float cx = x + ShotCaption.DotX(run.Size);
                    float cy = run.Baseline - ShotCaption.DotRise(run.Size);
                    Quad(dot, colour, cx - d / 2, cy - d / 2, cx + d / 2, cy + d / 2);
                    x += ShotCaption.Separator(run.Size);
                }
                x = Text(f, run.Parts[i], run.Size, x, run.Baseline, colour);
            }
        }

        // One line of text from the font's own texture. Returns where the
        // next character would go.
        float Text(Font f, string text, int size, float x, float baseline, Color colour)
        {
            if (string.IsNullOrEmpty(text)) return x;
            f.material.SetPass(0);
            GL.Begin(GL.QUADS);
            GL.Color(Linear(colour));
            foreach (char ch in text)
            {
                if (!f.GetCharacterInfo(ch, out CharacterInfo c, size)) continue;
                float l = x + c.minX, r = x + c.maxX, t = baseline - c.maxY, b = baseline - c.minY;
                GL.TexCoord(c.uvTopLeft);
                GL.Vertex3(l, t, 0);
                GL.TexCoord(c.uvTopRight);
                GL.Vertex3(r, t, 0);
                GL.TexCoord(c.uvBottomRight);
                GL.Vertex3(r, b, 0);
                GL.TexCoord(c.uvBottomLeft);
                GL.Vertex3(l, b, 0);
                x += c.advance;
            }
            GL.End();
            return x;
        }

        // A textured, tinted rectangle, y down; vTop and vBottom pick the
        // rows of the texture it shows.
        void Quad(Texture tex, Color colour, float x0, float y0, float x1, float y1, float vTop = 1, float vBottom = 0)
        {
            fill.mainTexture = tex;
            fill.SetPass(0);
            GL.Begin(GL.QUADS);
            GL.Color(Linear(colour));
            GL.TexCoord2(0, vTop);
            GL.Vertex3(x0, y0, 0);
            GL.TexCoord2(1, vTop);
            GL.Vertex3(x1, y0, 0);
            GL.TexCoord2(1, vBottom);
            GL.Vertex3(x1, y1, 0);
            GL.TexCoord2(0, vBottom);
            GL.Vertex3(x0, y1, 0);
            GL.End();
        }

        // GL's colours go to the shader as they are; in a linear project the
        // shader expects linear ones.
        static Color Linear(Color c)
        {
            return QualitySettings.activeColorSpace == ColorSpace.Linear ? c.linear : c;
        }

        void EnsureTools()
        {
            if (!fill) fill = new Material(Shader.Find("UI/Default")) { hideFlags = HideFlags.HideAndDontSave };
            if (!dot)
            {
                // A soft-edged white disc for the separators.
                const int n = 64;
                dot = new Texture2D(n, n, TextureFormat.RGBA32, false) { hideFlags = HideFlags.HideAndDontSave, filterMode = FilterMode.Bilinear, wrapMode = TextureWrapMode.Clamp };
                var px = new Color32[n * n];
                for (int y = 0; y < n; y++)
                    for (int x = 0; x < n; x++)
                    {
                        float d = Mathf.Sqrt((x + 0.5f - n / 2f) * (x + 0.5f - n / 2f) + (y + 0.5f - n / 2f) * (y + 0.5f - n / 2f));
                        px[y * n + x] = new Color32(255, 255, 255, (byte)(Mathf.Clamp01(n / 2f - d) * 255));
                    }
                dot.SetPixels32(px);
                dot.Apply(false, true);
            }
        }

        /* ---- saving ---- */

        static string FileName()
        {
            DateTime d = DateTime.Now;
            return string.Format("uwustack-{0:yyyy-MM-dd-HHmmss}.png", d);
        }

#if UNITY_WEBGL && !UNITY_EDITOR
        [DllImport("__Internal")]
        static extern void UwuStackDownload(string name, byte[] png, int length);
#endif

        static string Save(byte[] png, string name)
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            UwuStackDownload(name, png, png.Length);
            return name;
#else
            string dir = Folder();
            Directory.CreateDirectory(dir);
            string path = Path.Combine(dir, name);
            File.WriteAllBytes(path, png);
            return path;
#endif
        }

        static string Folder()
        {
            string own = Path.Combine(Application.persistentDataPath, "Screenshots");
            if (Application.isMobilePlatform) return own;
            string downloads = Downloads();
            return !string.IsNullOrEmpty(downloads) && Directory.Exists(downloads) ? downloads : own;
        }

        // The Downloads folder: Windows' known folder, wherever the user
        // moved it; XDG's on Linux; ~/Downloads otherwise.
        static string Downloads()
        {
            string home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
#if UNITY_STANDALONE_WIN || UNITY_EDITOR_WIN
            try
            {
                if (SHGetKnownFolderPath(new Guid("374DE290-123F-4565-9164-39C4925E467B"), 0, IntPtr.Zero, out IntPtr p) == 0)
                {
                    string known = Marshal.PtrToStringUni(p);
                    Marshal.FreeCoTaskMem(p);
                    if (!string.IsNullOrEmpty(known)) return known;
                }
            }
            catch (Exception)
            {
                // Falls back to the usual place.
            }
#elif UNITY_STANDALONE_LINUX || UNITY_EDITOR_LINUX
            string xdg = XdgDownloads(home);
            if (xdg != null) return xdg;
#endif
            return Path.Combine(home, "Downloads");
        }

#if UNITY_STANDALONE_WIN || UNITY_EDITOR_WIN
        [DllImport("shell32.dll")]
        static extern int SHGetKnownFolderPath([MarshalAs(UnmanagedType.LPStruct)] Guid id, uint flags, IntPtr token, out IntPtr path);
#endif

        // XDG_DOWNLOAD_DIR from ~/.config/user-dirs.dirs, such as
        // "$HOME/Téléchargements".
        public static string XdgDownloads(string home)
        {
            try
            {
                string file = Path.Combine(home, ".config", "user-dirs.dirs");
                if (!File.Exists(file)) return null;
                foreach (string line in File.ReadAllLines(file))
                {
                    string l = line.Trim();
                    if (!l.StartsWith("XDG_DOWNLOAD_DIR=")) continue;
                    string v = l.Substring("XDG_DOWNLOAD_DIR=".Length).Trim('"');
                    return v.Replace("$HOME", home);
                }
            }
            catch (Exception)
            {
                // Falls back to ~/Downloads.
            }
            return null;
        }
    }
}
