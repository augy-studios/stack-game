// The rain, ported from js/rain.js. Scripts/Rain.cs draws it with
// Graphics.RenderPrimitives, no mesh: one instance a drop, its corners from
// SV_VertexID, its own random numbers from SV_InstanceID.
//
// Every drop's whole life is a function of the clock: where it falls (in a
// box round where the camera looks, wrapping round its edges in the world,
// so the drops hold still as the camera moves), where it lands (the water
// riding its waves, the island's grass and sand, or the top of the tower),
// and its splash. Materials/RainDrops draws each drop as a thin streak, as
// long as the way it falls in a moment, faded at the box's sides and right
// by the camera, never thinner than a pixel and a bit. Materials/
// RainSplashes (Splashes ticked) draws each drop's own splash: a few
// droplets thrown up in a tiny crown that fall straight back, and on the
// water a ring spreading from where it went in. Low quality draws the drops
// only.
//
// The waves and the island's shape are Shaders/Water.shader's: change them
// together.
Shader "uwuStack/Rain"
{
    Properties
    {
        _Colour ("Colour", Color) = (0.62, 0.68, 0.76, 1)
        _Opacity ("Opacity", Float) = 0.75
        [Toggle(_SPLASH)] _Splash ("Splashes", Float) = 0
    }

    SubShader
    {
        Tags { "RenderType" = "Transparent" "RenderPipeline" = "UniversalPipeline" "Queue" = "Transparent+10" }

        Pass
        {
            Name "Rain"
            Blend SrcAlpha OneMinusSrcAlpha
            ZWrite Off
            Cull Off

            HLSLPROGRAM
            #pragma target 3.5
            #pragma vertex vert
            #pragma fragment frag
            #pragma shader_feature_local _SPLASH
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            CBUFFER_START(UnityPerMaterial)
                half4 _Colour;
                float _Opacity;
                float _Splash;
                // Set each frame by Scripts/Rain.cs.
                float _RainTime;    // the water's clock, seconds
                float4 _Centre;     // the box's centre x, z, and the top it falls from, y
                float _Range;       // half the box's width
                float _Speed;       // how fast a drop falls, units a second
                float4 _Wind;       // x, z: how fast the wind carries it across
                float _Level;       // the water's height
                float4 _Tower;      // the top layer: x, z, half its width and depth
                float _TowerTop;
                float _Amount;      // the share of the drops falling, 0 to 1
                float _Length;      // a streak's length
                float _Width;       // a streak's width, near by
                float _Pixel;       // a pixel's width at a unit's distance
                float _Flash;       // a lightning strike lighting the drops
            CBUFFER_END

            static const float FALL = 12.0;
            static const float SPLASH = 0.55;
            static const float SAND_TOP_R = 2.3;
            static const float STEEP = 0.5;

            // Shaders/Water.shader's waves.
            void gerstner(float2 p, float2 dir, float len, float amp, float t, inout float3 disp)
            {
                float k = 6.2831853 / len;
                float w = sqrt(9.8 * k) * 0.6;
                float2 d = normalize(dir);
                float f = k * dot(d, p) - w * t;
                float q = STEEP / (k * amp * 3.0);
                disp.xz += q * amp * d * cos(f);
                disp.y += amp * sin(f);
            }

            float waveHeight(float2 p, float t)
            {
                float3 disp = 0;
                gerstner(p, float2(1.0, 0.35), 7.5, 0.045, t, disp);
                gerstner(p, float2(0.55, -0.85), 4.9, 0.028, t, disp);
                gerstner(p, float2(-0.3, 1.0), 3.6, 0.018, t, disp);
                return disp.y * lerp(0.35, 1.0, smoothstep(0.8, 3.0, length(p)));
            }

            // GLSL's mod, which floors; HLSL's fmod truncates.
            float modulo(float x, float y) { return x - y * floor(x / y); }
            float2 modulo(float2 x, float y) { return x - y * floor(x / y); }

            float islandRadius(float2 p)
            {
                float a = modulo(atan2(p.x, p.y), 0.6283185) - 0.3141593;
                return length(p) * cos(a) / 0.9510565;
            }

            float ground(float r)
            {
                if (r < 2.05) return -0.95;
                if (r < 2.3) return -1.06;
                if (r < 3.2) return -1.06 - (r - 2.3) * 3.3333;
                return -4.06 - (r - 3.2) * 2.0;
            }

            // Four numbers in [0, 1) for a drop (PCG hash).
            uint pcg(uint v)
            {
                uint s = v * 747796405u + 2891336453u;
                uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
                return (w >> 22u) ^ w;
            }

            float4 seedOf(uint id)
            {
                return float4(pcg(id * 4u), pcg(id * 4u + 1u), pcg(id * 4u + 2u), pcg(id * 4u + 3u)) / 4294967296.0;
            }

            // A drop's life this time round:
            //   p        where it set off, across
            //   age      seconds since it set off
            //   hit      the height it lands at
            //   fallT    seconds it takes to get there
            //   onWater  1 into the water, 0 onto something solid, -1 let go unseen
            void dropState(float4 seed, out float2 p, out float age, out float hit, out float fallT, out float onWater)
            {
                float period = FALL / _Speed + SPLASH;
                float local = _RainTime + seed.z * period;
                float cycle = floor(local / period);
                age = local - cycle * period;
                float2 r = frac(seed.xy + cycle * float2(0.6180340, 0.7548777));
                float span = 2.0 * _Range;
                float2 corner = _Centre.xz - _Range;
                p = corner + modulo(r * span - corner, span);

                float top = _Centre.y;
                float guess = clamp((top - _Level) / _Speed, 0.0, FALL / _Speed);
                float2 q = p + _Wind.xy * guess;
                float water = _Level + waveHeight(q, _RainTime);
                float solid = -1000.0;
                float rr = islandRadius(q);
                if (rr < SAND_TOP_R) solid = ground(rr);
                float2 inside = abs(q - _Tower.xy) - _Tower.zw;
                if (max(inside.x, inside.y) < 0.0) solid = max(solid, _TowerTop);
                onWater = solid > water ? 0.0 : 1.0;
                hit = max(water, solid);
                if (hit < top - FALL)
                {
                    hit = top - FALL;
                    onWater = -1.0;
                }
                fallT = (top - hit) / _Speed;
            }

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float4 data : TEXCOORD0;    // drops: across, along, alpha; splashes: uv, s, part
                float rand : TEXCOORD1;
            };

            static const float2 STREAK[4] = { float2(-0.5, 0), float2(0.5, 0), float2(-0.5, 1), float2(0.5, 1) };
            static const float2 RING[4] = { float2(-1, -1), float2(1, -1), float2(-1, 1), float2(1, 1) };
            static const float2 CROWN[4] = { float2(-1, 0), float2(1, 0), float2(-1, 1), float2(1, 1) };
            static const uint QUAD[6] = { 0, 1, 2, 1, 3, 2 };

            Varyings vert(uint vid : SV_VertexID, uint iid : SV_InstanceID)
            {
                Varyings o = (Varyings)0;
                float4 seed = seedOf(iid);
                o.rand = seed.w;
                float2 p;
                float age, hit, fallT, onWater;
                dropState(seed, p, age, hit, fallT, onWater);

            #if defined(_SPLASH)
                uint part = vid / 6u;
                uint corner = QUAD[vid % 6u];
                float s = (age - fallT) / SPLASH;
                float on = step(0.0, s) * step(s, 1.0) * step(seed.w, _Amount) * step(0.0, onWater);
                float2 at = p + _Wind.xy * fallT;
                float y = onWater > 0.5 ? _Level + waveHeight(at, _RainTime) : hit;
                float size = 0.7 + 0.6 * frac(seed.w * 13.7);
                float3 pos;
                float2 uv;
                if (part == 0u)
                {
                    // The ring, on the water only.
                    on *= onWater;
                    uv = RING[corner];
                    float r = (0.02 + 0.15 * sqrt(max(s, 0.0))) * size;
                    pos = float3(at.x + uv.x * r, y + 0.004, at.y + uv.y * r);
                }
                else
                {
                    // The crown, stood up to face the camera.
                    on *= step(s * 2.6, 1.0);
                    uv = CROWN[corner];
                    float3 base = float3(at.x, y, at.y);
                    float2 h = normalize(_WorldSpaceCameraPos.xz - base.xz + 1e-4);
                    float3 side = float3(-h.y, 0.0, h.x);
                    pos = base + side * uv.x * 0.05 * size + float3(0.0, uv.y * 0.07 * size, 0.0);
                }
                o.data = float4(uv, s, (float)part);
                o.positionCS = on > 0.5 ? TransformWorldToHClip(pos) : float4(2, 2, 2, 1);
            #else
                float2 c = STREAK[QUAD[vid % 6u]];
                float3 dir = normalize(float3(_Wind.x, -_Speed, _Wind.y));
                float2 xz = p + _Wind.xy * age;
                float3 head = float3(xz.x, _Centre.y - _Speed * age, xz.y);
                float3 tail = head - dir * _Length;
                // Cut off where it lands: the tail follows the head in.
                head.y = max(head.y, hit);
                tail.y = max(tail.y, hit);
                float3 mid = lerp(head, tail, c.y);
                float3 toCam = _WorldSpaceCameraPos - mid;
                float dist = length(toCam);
                float3 side = normalize(cross(dir, toCam));
                float w = max(_Width, dist * _Pixel * 1.7);
                float2 off = abs(xz - _Centre.xz) / _Range;
                float edge = 1.0 - smoothstep(0.7, 1.0, max(off.x, off.y));
                float nearCam = smoothstep(0.4, 1.4, dist);
                float alpha = step(seed.w, _Amount) * edge * nearCam * (_Width / w) * (0.7 + 0.6 * frac(seed.w * 31.7));
                o.data = float4(c.x * 2.0, c.y, alpha, 0);
                o.positionCS = TransformWorldToHClip(mid + side * c.x * w);
            #endif
                return o;
            }

            float rnd(float x, float r)
            {
                return frac(sin(x * 12.9898 + r * 78.233) * 43758.5453);
            }

            half4 frag(Varyings i) : SV_Target
            {
                float a = 0.0;
            #if defined(_SPLASH)
                float2 uv = i.data.xy;
                float s = i.data.z;
                if (i.data.w < 0.5)
                {
                    // A ring, and a fainter one inside it once it has spread.
                    float d = length(uv);
                    // Squared by hand: pow() of a negative number is undefined.
                    float ro = (d - 0.8) * 9.0;
                    float ri = (d - 0.42) * 12.0;
                    float ring = exp(-ro * ro);
                    float inner = exp(-ri * ri) * smoothstep(0.25, 0.6, s) * 0.5;
                    a = (ring + inner) * (1.0 - s) * (1.0 - s) * 0.5;
                }
                else
                {
                    // Droplets thrown up and out on arcs, falling back, and
                    // the drop's own rebound, a little column, at the start.
                    float k = saturate(s * 2.6);
                    [unroll] for (int n = 0; n < 5; n++)
                    {
                        float r = rnd(n + 1.0, i.rand);
                        float outward = (n - 2.0) * 0.5 * (0.55 + 0.4 * r);
                        float up = 0.7 + 0.3 * rnd(n + 7.0, i.rand);
                        float2 c = float2(outward * k * 0.9, up * 2.2 * k - 2.0 * k * k);
                        float rad = 0.11 * (1.0 - 0.45 * k);
                        a = max(a, 1.0 - smoothstep(rad * 0.5, rad, length((uv - c) * float2(1.0, 1.4))));
                    }
                    float column = (1.0 - smoothstep(0.03, 0.12, abs(uv.x))) * (1.0 - smoothstep(0.0, 0.08, uv.y - 2.0 * k * (1.0 - k) * 0.7));
                    a = max(a, column * (1.0 - k));
                    a *= (1.0 - k) * 0.8;
                }
                float3 colour = _Colour.rgb * (1.0 + _Flash * 0.3);
            #else
                float across = i.data.x;
                a = (1.0 - across * across) * (1.0 - 0.75 * i.data.y) * i.data.z;
                float3 colour = _Colour.rgb * (1.0 + _Flash * 0.5);
            #endif
                a *= _Opacity;
                clip(a - 0.002);
                return half4(colour, a);
            }
            ENDHLSL
        }
    }
}
