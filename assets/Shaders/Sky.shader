// The sky, as a skybox material (Lighting > Environment > Skybox Material).
//
// The game draws it flat across the screen, top to bottom, so the whole
// gradient shows whichever way the camera looks: horizon colour at 45% of
// the screen's height, easing to the top colour above and the bottom
// colour below, and a soft glow low in the middle where the light is. Being
// a skybox here changes none of that: it works out where on the screen each
// pixel is, not where it looks.
//
// Over it, as js/scene.js's SKY_FRAGMENT, worked out per pixel:
//   stars    one or none in each cell of a grid, twinkling
//   meteors  now and then a shooting star, at night
//   cirrus   thin, unshaded streaks of high cloud
//   cumulus  heaped clouds lower down, lit on top and shaded underneath
//   rain     _Overcast thickens the cumulus; _Flash lights the whole sky
//            for a lightning strike, most round _FlashX (the bolt's place
//            across the screen, 0 to 1), the clouds from inside, brighter
//            than white so the bloom takes it (Scripts/Rain.cs)
// The two cloud layers lie on flat planes overhead, seen in perspective,
// and the wind carries them in from the horizon. _Pan turns them, and the
// stars, with the camera.
//
// Scripts/SceneLook.cs moves the colours as the tower climbs and sets the
// theme's strengths and _Pan. Tick Low Quality for slower devices: fewer
// octaves of noise.
Shader "uwuStack/Sky"
{
    Properties
    {
        _TopColor ("Top", Color) = (0.62, 0.83, 0.93, 1)
        _HorizonColor ("Horizon", Color) = (0.93, 0.95, 0.85, 1)
        _BottomColor ("Bottom", Color) = (0.87, 0.89, 0.71, 1)
        _Glow ("Glow", Range(0, 1)) = 0.35
        _StarsOpacity ("Stars Opacity", Range(0, 1)) = 0.6
        _Meteors ("Meteors", Range(0, 1)) = 0
        _CloudLit ("Cloud Lit", Color) = (1, 1, 1, 1)
        _CloudShade ("Cloud Shade", Color) = (0.8, 0.84, 0.92, 1)
        _Cumulus ("Cumulus", Range(0, 1)) = 0.85
        _Cirrus ("Cirrus", Range(0, 1)) = 0.55
        _Pan ("Pan", Float) = 0
        _Overcast ("Overcast", Range(0, 1)) = 0
        _Flash ("Lightning Flash", Float) = 0
        _FlashX ("Lightning Across", Float) = 0.5
        [Toggle(_LOW_QUALITY)] _LowQuality ("Low Quality", Float) = 0
    }

    SubShader
    {
        Tags { "Queue" = "Background" "RenderType" = "Background" "PreviewType" = "Skybox" "RenderPipeline" = "UniversalPipeline" }
        Cull Off
        ZWrite Off

        Pass
        {
            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma shader_feature_local _LOW_QUALITY
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            #if defined(_LOW_QUALITY)
                #define OCTAVES 3
            #else
                #define OCTAVES 5
            #endif

            CBUFFER_START(UnityPerMaterial)
                half4 _TopColor;
                half4 _HorizonColor;
                half4 _BottomColor;
                half _Glow;
                half _StarsOpacity;
                half _Meteors;
                half4 _CloudLit;
                half4 _CloudShade;
                half _Cumulus;
                half _Cirrus;
                float _Pan;
                half _Overcast;
                float _Flash;
                float _FlashX;
                float _LowQuality;
            CBUFFER_END

            struct Attributes { float4 positionOS : POSITION; };
            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float4 screenPos : TEXCOORD0;
            };

            Varyings vert(Attributes v)
            {
                Varyings o;
                o.positionCS = TransformObjectToHClip(v.positionOS.xyz);
                o.screenPos = ComputeScreenPos(o.positionCS);
                return o;
            }

            static const float2x2 Turn = float2x2(0.8, -0.6, 0.6, 0.8);

            float Hash(float2 p)
            {
                p = frac(p * float2(123.34, 456.21));
                p += dot(p, p + 45.32);
                return frac(p.x * p.y);
            }

            float Noise(float2 p)
            {
                float2 i = floor(p);
                float2 f = frac(p);
                float2 u = f * f * (3.0 - 2.0 * f);
                return lerp(lerp(Hash(i), Hash(i + float2(1, 0)), u.x),
                            lerp(Hash(i + float2(0, 1)), Hash(i + float2(1, 1)), u.x), u.y);
            }

            float Fbm(float2 p)
            {
                float v = 0.0;
                float a = 0.5;
                [unroll] for (int i = 0; i < OCTAVES; i++)
                {
                    v += a * Noise(p);
                    p = mul(Turn, p) * 2.03 + 17.1;
                    a *= 0.5;
                }
                return v;
            }

            // Two octaves, for the broad, slow fields that only steer the
            // detail.
            float Fbm2(float2 p)
            {
                return 0.5 * Noise(p) + 0.25 * Noise(mul(Turn, p) * 2.03 + 17.1);
            }

            float Cumulus(float2 p, float t)
            {
                float shape = Fbm2(p * 0.55) * 1.33;
                float billow = Fbm(p * 1.7 + float2(t * 0.02, -t * 0.015));
                return shape * 0.75 + billow * 0.35;
            }

            float Segment(float2 p, float2 a, float2 b)
            {
                float2 pa = p - a;
                float2 ba = b - a;
                float h = saturate(dot(pa, ba) / dot(ba, ba));
                return length(pa - ba * h);
            }

            half4 frag(Varyings i) : SV_Target
            {
                float2 uv = i.screenPos.xy / i.screenPos.w;
                float y = uv.y;
                float t = _Time.y;
                float aspect = _ScreenParams.x / _ScreenParams.y;
                float3 c = y > 0.45
                    ? lerp(_HorizonColor.rgb, _TopColor.rgb, smoothstep(0.45, 1.0, y))
                    : lerp(_BottomColor.rgb, _HorizonColor.rgb, smoothstep(0.0, 0.45, y));
                float2 d = float2((uv.x - 0.5) * aspect, y - 0.52);
                float glow = exp(-dot(d, d) * 5.0);
                c = lerp(c, float3(1, 1, 1), _Glow * glow);

                // Stars: a grid of cells about 26 of the web game's pixels
                // across, a star in some, fewer towards the horizon.
                float scale = max(1.0, _ScreenParams.y / 860.0);
                float2 px = uv * _ScreenParams.xy / scale + float2(_Pan * _ScreenParams.x / scale, 0);
                float2 cell = floor(px / 26.0);
                float pick = Hash(cell);
                float above = smoothstep(0.3, 1.0, y);
                if (pick < 0.32 * above)
                {
                    float2 at = (cell + 0.2 + 0.6 * float2(Hash(cell + 3.1), Hash(cell + 7.7))) * 26.0;
                    float size = 0.7 + 0.8 * Hash(cell + 11.3);
                    float twinkle = 0.55 + 0.45 * sin(t * (1.2 + 2.5 * Hash(cell + 5.9)) + pick * 60.0);
                    float star = 1.0 - smoothstep(size * 0.5, size + 0.6, length(px - at));
                    c = lerp(c, float3(1, 1, 1), star * twinkle * _StarsOpacity);
                }

                // Meteors: two slots, each now and then streaking a short
                // way down across the upper sky.
                float2 sp = float2(uv.x * aspect, y);
                [unroll] for (int m = 0; m < 2; m++)
                {
                    float period = 7.0 + m * 4.0;
                    float k = floor(t / period + m * 0.5);
                    float age = t - (k - m * 0.5) * period;
                    float life = 0.9;
                    if (age < life && Hash(float2(k, m)) < 0.7)
                    {
                        float2 start = float2((0.15 + 0.7 * Hash(float2(k, 2.0 + m))) * aspect, 0.72 + 0.25 * Hash(float2(k, 9.0)));
                        float2 dir = normalize(float2(Hash(float2(k, 4.0)) < 0.5 ? -1.0 : 1.0, -0.55));
                        float run = age / life;
                        float2 head = start + dir * run * 0.45;
                        float2 tail = head - dir * 0.12 * min(1.0, run * 4.0);
                        float dist = Segment(sp, tail, head);
                        float along = saturate(dot(sp - tail, dir) / 0.12);
                        float streak = (1.0 - smoothstep(0.0, 0.0025, dist)) * along * (1.0 - run);
                        c = lerp(c, float3(1, 1, 1), streak * _Meteors);
                    }
                }

                float h = y - 0.4;
                float cloudy = 0.0;
                if (h > 0.0)
                {
                    // Cirrus, on a high plane.
                    float far = 1.0 / (h + 0.25);
                    float2 q = float2((uv.x - 0.5 + _Pan) * aspect * far * 1.2, far * 2.0);
                    q += float2(t * 0.012, t * 0.02);
                    float2 comb = float2(Fbm2(q * 0.6), Fbm2(q * 0.6 + 5.2)) * 1.33;
                    float streaks = Fbm(float2(q.x * 0.9, q.y * 5.0) + comb * 1.6);
                    float patches = smoothstep(0.35, 0.65, Fbm2(q * 0.35 - 3.0) * 1.33);
                    float cirrus = smoothstep(0.5, 0.8, streaks) * patches * smoothstep(0.02, 0.25, h);
                    c = lerp(c, _CloudLit.rgb, cirrus * _Cirrus);

                    // Cumulus, on a lower plane: shaded where there is more
                    // cloud just above, lit where there is less.
                    float nearPlane = 1.0 / (h + 0.08);
                    float2 p = float2((uv.x - 0.5 + _Pan) * aspect * nearPlane * 0.9, nearPlane * 1.4);
                    p += float2(t * 0.03, t * 0.05);
                    // Rain thickens the cloud.
                    float dens = Cumulus(p, t) + _Overcast * 0.24;
                    float body = smoothstep(0.5, 0.6, dens);
                    cloudy = body * smoothstep(0.0, 0.18, h);
                    if (body > 0.0)
                    {
                        float upper = Cumulus(p + float2(0.0, 0.35), t);
                        float under = smoothstep(-0.02, 0.12, upper - dens) * smoothstep(0.03, 0.3, h);
                        float3 cloud = lerp(_CloudLit.rgb, _CloudShade.rgb, saturate(under + (1.0 - body) * 0.3));
                        cloud = lerp(cloud, float3(1, 1, 1), glow * _Glow * (1.0 - body) * 1.5);
                        float haze = smoothstep(0.0, 0.18, h);
                        c = lerp(c, cloud, body * haze * _Cumulus);
                    }
                }

                // Lightning: the whole sky lit for an instant, most round the
                // bolt, the clouds from inside.
                if (_Flash > 0.0)
                {
                    float x = (uv.x - _FlashX) * aspect;
                    float nearBolt = exp(-x * x * 3.0);
                    float lit = _Flash * (0.25 + 0.75 * nearBolt) * (0.35 + 0.65 * smoothstep(0.3, 0.8, y)) * (0.6 + 0.9 * cloudy);
                    c += float3(0.82, 0.86, 1.0) * lit;
                }

                return half4(c, 1);
            }
            ENDHLSL
        }
    }
}
