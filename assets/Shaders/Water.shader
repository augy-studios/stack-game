// The sea, ported from WATER_VERTEX and WATER_FRAGMENT in js/scene.js. Put
// it on Meshes/WaterHigh.fbx (or WaterLow.fbx with Low Quality on) at the
// water's height; Scripts/WaterSurface.cs keeps the rest up to date.
//
// Gerstner waves, as in GPU Gems, chapter 1: each moves the surface round
// in circles, so the crests come out sharp and the troughs broad. Deep
// water's dispersion sets their speed. The vertex stage moves the mesh; the
// fragment stage takes the exact normal at every pixel, adds ripples too
// fine for the mesh and the rings spreading from where pieces went in, and
// shades the water by its depth over the island, with the sky mirrored
// towards the horizon, a hard glint of sun, and foam.
//
// The island's shape is built in: a ten-sided outline, grass to 2.05 units
// out at 0.95 below the base's top, sand to 2.3 at 1.06 below, sloping to
// 3.2 at 4.06 below, then deep water. Scenery set up differently needs
// ground() and islandRadius() changed to match.
Shader "uwuStack/Water"
{
    Properties
    {
        _DeepColor ("Deep", Color) = (0.37, 0.69, 0.82, 1)
        _ShallowColor ("Shallow", Color) = (0.55, 0.85, 0.83, 1)
        _HorizonColor ("Horizon (sky)", Color) = (0.93, 0.95, 0.85, 1)
        _TopColor ("Top (sky)", Color) = (0.62, 0.83, 0.93, 1)
        _FoamColor ("Foam", Color) = (1, 1, 1, 1)
        _SunDir ("Sun Direction (towards the sun)", Vector) = (1, 0.36, -1, 0)
        _Glint ("Glint", Float) = 1
        _Near ("Fade Start", Float) = 14
        _Far ("Fade End", Float) = 70
        _Level ("Water Level (world y)", Float) = -1.6
        _Shore ("Shore Radius (-1 for none)", Float) = -1
        _Column ("Tower At Waterline (x, z, half x, half z)", Vector) = (0, 0, -1, -1)
        [Toggle(_LOW_QUALITY)] _LowQuality ("Low Quality", Float) = 0
    }

    SubShader
    {
        Tags { "RenderType" = "Transparent" "RenderPipeline" = "UniversalPipeline" "Queue" = "Transparent" }

        Pass
        {
            Name "Water"
            Blend SrcAlpha OneMinusSrcAlpha
            ZWrite Off
            Cull Back

            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma shader_feature_local _LOW_QUALITY
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            #define RIPPLES 4

            CBUFFER_START(UnityPerMaterial)
                half4 _DeepColor;
                half4 _ShallowColor;
                half4 _HorizonColor;
                half4 _TopColor;
                half4 _FoamColor;
                float4 _SunDir;
                float _Glint;
                float _Near;
                float _Far;
                float _Level;
                float _Shore;
                float4 _Column;
                float _LowQuality;
            CBUFFER_END

            // The latest few places pieces went in: (x, z, seconds ago, how
            // hard 0.4 to 1), or z < 0 for none. Set with
            // Material.SetVectorArray("_Ripples", ...).
            float4 _Ripples[RIPPLES];

            // The scene's clock, in seconds. Scripts/WaterSurface.cs sets
            // it; it falls back to Unity's own if nothing does.
            float _WaterTime;

            static const float STEEP = 0.5;

            void gerstner(float2 p, float2 dir, float len, float amp, float t, inout float3 disp, inout float3 nrm)
            {
                float k = 6.2831853 / len;
                float w = sqrt(9.8 * k) * 0.6;
                float2 d = normalize(dir);
                float f = k * dot(d, p) - w * t;
                float q = STEEP / (k * amp * 3.0);
                float s = sin(f);
                float c = cos(f);
                disp.xz += q * amp * d * c;
                disp.y += amp * s;
                nrm.xz -= d * (k * amp * c);
                nrm.y -= q * k * amp * s;
            }

            // Calmer close in, so the waterline on the tower stays where the
            // game has it: the waves are only for show.
            float3 swell(float2 p, float t, out float3 nrm)
            {
                float3 disp = 0;
                nrm = float3(0, 1, 0);
                gerstner(p, float2(1.0, 0.35), 7.5, 0.045, t, disp, nrm);
                gerstner(p, float2(0.55, -0.85), 4.9, 0.028, t, disp, nrm);
                gerstner(p, float2(-0.3, 1.0), 3.6, 0.018, t, disp, nrm);
                float calm = lerp(0.35, 1.0, smoothstep(0.8, 3.0, length(p)));
                nrm = float3(nrm.x * calm, 1.0 - (1.0 - nrm.y) * calm, nrm.z * calm);
                return disp * calm;
            }

            float clock() { return _WaterTime > 0 ? _WaterTime : _Time.y; }

            struct Attributes { float4 positionOS : POSITION; };

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float3 world : TEXCOORD0;
                float2 flat : TEXCOORD1;
                float height : TEXCOORD2;
                float3 waveNormal : TEXCOORD3;
            };

            Varyings vert(Attributes v)
            {
                Varyings o;
                float3 world = TransformObjectToWorld(v.positionOS.xyz);
                float3 n;
                float3 disp = swell(world.xz, clock(), n);
                o.flat = world.xz;
                o.height = disp.y;
                o.waveNormal = n;
                world += disp;
                o.world = world;
                o.positionCS = TransformWorldToHClip(world);
                return o;
            }

            float hash(float2 p)
            {
                return frac(sin(dot(p, float2(127.1, 311.7))) * 43758.5453);
            }

            float noise(float2 p)
            {
                float2 i = floor(p);
                float2 f = frac(p);
                float2 u = f * f * (3.0 - 2.0 * f);
                return lerp(lerp(hash(i), hash(i + float2(1, 0)), u.x), lerp(hash(i + float2(0, 1)), hash(i + float2(1, 1)), u.x), u.y);
            }

            // GLSL's mod, which floors; HLSL's fmod truncates.
            float modulo(float x, float y) { return x - y * floor(x / y); }

            // How far out p is on the island's ten-sided outline: its
            // distance to the side facing it, scaled to the corners' radius.
            float islandRadius(float2 p)
            {
                float a = modulo(atan2(p.x, p.y), 0.6283185) - 0.3141593;
                return length(p) * cos(a) / 0.9510565;
            }

            // The bottom under the water at that radius: grass, the sand's
            // top, its slope, then a drop away into deep water.
            float ground(float r)
            {
                if (r < 2.05) return -0.95;
                if (r < 2.3) return -1.06;
                if (r < 3.2) return -1.06 - (r - 2.3) * 3.3333;
                return -4.06 - (r - 3.2) * 2.0;
            }

            // Ripples riding on the swell, too fine for the mesh, so only
            // in the shading. Each fades out before it is too small on
            // screen to draw cleanly.
            void chop(float2 p, float2 dir, float len, float t, float dist, inout float3 nrm)
            {
                float k = 6.2831853 / len;
                float w = sqrt(9.8 * k) * 0.6;
                float2 d = normalize(dir);
                float fade = 1.0 - smoothstep(len * 30.0, len * 90.0, dist);
                nrm.xz -= d * cos(k * dot(d, p) - w * t) * 0.035 * fade;
            }

            half4 frag(Varyings i) : SV_Target
            {
                float t = clock();
                float2 p = i.flat;
                float churn = 0.0;
                float grain = 0.5;
            #if defined(_LOW_QUALITY)
                // The mesh's own normal, no ripples, plain foam.
                float3 n = normalize(i.waveNormal);
            #else
                float dist = length(_WorldSpaceCameraPos - i.world);
                float3 n;
                swell(p, t, n);
                chop(p, float2(0.8, 0.6), 1.7, t, dist, n);
                chop(p, float2(-0.6, 0.9), 1.1, t, dist, n);
                chop(p, float2(0.95, -0.3), 0.73, t, dist, n);
                chop(p, float2(-0.2, -1.0), 0.47, t, dist, n);
                chop(p, float2(0.4, 0.9), 0.31, t, dist, n);

                // Rings spreading from where pieces went in, white water
                // where they did.
                [unroll]
                for (int r = 0; r < RIPPLES; r++)
                {
                    float4 ring = _Ripples[r];
                    if (ring.z < 0.0) continue;
                    float2 d = p - ring.xy;
                    float rr = length(d) + 0.0001;
                    float front = 0.12 + ring.z * 0.9;
                    float env = exp(-pow((rr - front) * 5.0, 2.0)) * ring.w * exp(-ring.z * 1.2);
                    n.xz += (d / rr) * sin((rr - front) * 30.0) * env * 0.5;
                    churn += ring.w * exp(-ring.z * 3.0) * (1.0 - smoothstep(0.05, 0.3 + ring.z * 0.4, rr));
                }
                n = normalize(n);
                grain = noise(p * 7.0 + float2(t * 0.3, 0.0)) * 0.6 + noise(p * 19.0 - float2(0.0, t * 0.5)) * 0.4;
            #endif

                // Fresnel: looking down, the water's own colour; towards the
                // horizon, more and more the sky it mirrors.
                float3 v = normalize(_WorldSpaceCameraPos - i.world);
                float fresnel = 0.02 + 0.98 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
                float3 sky = lerp(_HorizonColor.rgb, _TopColor.rgb, smoothstep(0.0, 0.6, reflect(-v, n).y));

                // Its colour comes from its depth: clear over the sand,
                // bluer as the bottom falls away, and a little light through
                // the thin crests.
                float radius = islandRadius(p);
                float depth = max(_Level - ground(radius), 0.0);
                float deep = 1.0 - exp(-depth * 1.1);
                float3 body = lerp(_ShallowColor.rgb, _DeepColor.rgb, deep);
                body += _ShallowColor.rgb * 0.18 * saturate(i.height / 0.04);
                float3 c = lerp(body, sky, fresnel);

                // The sun: a hard glint off facets turned just right, a
                // sheen round it.
                float nh = max(dot(n, normalize(normalize(_SunDir.xyz) + v)), 0.0);
                c += _Glint * (pow(nh, 900.0) * 2.2 + pow(nh, 80.0) * 0.12);

                // Foam where the water meets the island or the tower, on the
                // highest crests, and where something went in, broken up so
                // it reads as foam.
                float foam = 0.0;
                if (_Shore > 0.0)
                {
                    float s = radius - _Shore;
                    float surge = smoothstep(0.6, 1.0, sin(s * 26.0 - t * 2.4)) * (1.0 - smoothstep(0.03, 0.3, s));
                    foam = max(1.0 - smoothstep(0.0, 0.08, s), surge * 0.45);
                }
                if (_Column.z > 0.0)
                {
                    float s = length(max(abs(p - _Column.xy) - _Column.zw, 0.0));
                    foam = max(foam, 1.0 - smoothstep(0.0, 0.07, s));
                }
                foam *= smoothstep(0.35, 0.75, grain + foam * 0.2);
                foam = max(foam, smoothstep(0.045, 0.07, i.height) * smoothstep(0.62, 0.8, grain) * 0.8);
                foam = max(foam, saturate(churn) * smoothstep(0.2, 0.5, grain));
                foam = saturate(foam);
                c = lerp(c, _FoamColor.rgb, foam * 0.75);

                // The sea is a wide pool round the island that fades into
                // the sky, so the sky shows past it the way the tower floats
                // in it.
                float edge = smoothstep(_Near, _Far, length(i.world.xz));
                c = lerp(c, _HorizonColor.rgb, edge);
                float alpha = max(lerp(0.6, 0.95, deep), max(fresnel, foam));
                return half4(c, alpha * (1.0 - edge));
            }
            ENDHLSL
        }
    }
}
