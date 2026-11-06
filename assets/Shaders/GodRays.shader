// God rays, for Scripts/GodRays.cs, as js/post.js draws them: whatever
// bright sky and water shows past the tower and the island is smeared
// towards the sun at a quarter of the screen's size, then added back over
// the picture, faintly over anything solid so the beams do not streak
// down the tower.
//
//   pass 0  what lights the rays: open sky and water (the water writes no
//           depth) past a brightness threshold, nothing solid
//   pass 1  the radial blur towards the sun
//   pass 2  added onto the camera's picture
//   pass 3  how much of the sun shows, into Scripts/GodRays.cs's kept
//           pixel, blended so it eases from frame to frame: a grid of taps
//           over the sun's disc, each counting where it is open sky and
//           still bright (no cloud over it); taps past the screen's edge
//           count as showing
//   pass 4  the lens flare, added onto the camera's picture: glare and a
//           starburst round the sun, a streak across, a faint halo ring,
//           and ghosts along the line from the sun through the middle
Shader "Hidden/uwuStack/GodRays"
{
    SubShader
    {
        Tags { "RenderType" = "Opaque" "RenderPipeline" = "UniversalPipeline" }
        ZWrite Off
        ZTest Always
        Cull Off

        HLSLINCLUDE
        #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
        #include "Packages/com.unity.render-pipelines.core/Runtime/Utilities/Blit.hlsl"
        #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/DeclareDepthTexture.hlsl"

        #define SAMPLES 48

        float2 _SunScreen;
        float _Density;
        float _Decay;
        float _Threshold;
        float _Intensity;
        float4 _Tint;
        float _GodRaysLevel;
        float2 _SunRadius;
        float _Flare;

        // 1 where nothing solid was drawn: the sky, and the water.
        float Open(float2 uv)
        {
            float d = SampleSceneDepth(uv);
        #if UNITY_REVERSED_Z
            return step(d, 0.00001);
        #else
            return step(0.99999, d);
        #endif
        }

        float Hash(float2 p)
        {
            return frac(sin(dot(p, float2(12.9898, 78.233))) * 43758.5453);
        }
        ENDHLSL

        Pass
        {
            Name "GodRaysSource"
            HLSLPROGRAM
            #pragma vertex Vert
            #pragma fragment Frag

            half4 Frag(Varyings i) : SV_Target
            {
                float2 uv = i.texcoord;
                float3 c = min(SAMPLE_TEXTURE2D_X(_BlitTexture, sampler_LinearClamp, uv).rgb, 1.3);
                float l = dot(c, float3(0.2126, 0.7152, 0.0722));
                return half4(c * smoothstep(_Threshold, _Threshold + 0.45, l) * Open(uv), 1);
            }
            ENDHLSL
        }

        Pass
        {
            Name "GodRaysBlur"
            HLSLPROGRAM
            #pragma vertex Vert
            #pragma fragment Frag

            half4 Frag(Varyings i) : SV_Target
            {
                float2 uv = i.texcoord;
                float2 stride = (uv - _SunScreen) * _Density / SAMPLES;
                float2 at = uv - stride * Hash(i.positionCS.xy);
                float fade = 1.0;
                float3 sum = 0;
                [loop]
                for (int s = 0; s < SAMPLES; s++)
                {
                    at -= stride;
                    sum += SAMPLE_TEXTURE2D_X(_BlitTexture, sampler_LinearClamp, saturate(at)).rgb * fade;
                    fade *= _Decay;
                }
                return half4(sum / SAMPLES, 1);
            }
            ENDHLSL
        }

        Pass
        {
            Name "GodRaysAdd"
            Blend One One
            HLSLPROGRAM
            #pragma vertex Vert
            #pragma fragment Frag

            half4 Frag(Varyings i) : SV_Target
            {
                float2 uv = i.texcoord;
                float3 rays = SAMPLE_TEXTURE2D_X(_BlitTexture, sampler_LinearClamp, uv).rgb;
                float level = _GodRaysLevel > 0 ? _GodRaysLevel : 1;
                return half4(rays * _Tint.rgb * _Intensity * level * lerp(0.45, 1.0, Open(uv)), 0);
            }
            ENDHLSL
        }

        Pass
        {
            Name "SunVisible"
            Blend SrcAlpha OneMinusSrcAlpha
            HLSLPROGRAM
            #pragma vertex Vert
            #pragma fragment Frag

            half4 Frag(Varyings i) : SV_Target
            {
                float seen = 0;
                [unroll]
                for (int x = -2; x <= 2; x++)
                {
                    [unroll]
                    for (int y = -2; y <= 2; y++)
                    {
                        float2 at = _SunScreen + float2(x, y) * 0.5 * _SunRadius;
                        if (any(at < 0.0) || any(at > 1.0))
                        {
                            seen += 1;
                            continue;
                        }
                        float l = dot(SAMPLE_TEXTURE2D_X(_BlitTexture, sampler_PointClamp, at).rgb, float3(0.2126, 0.7152, 0.0722));
                        seen += Open(at) * smoothstep(1.02, 1.3, l);
                    }
                }
                return half4(seen.xxx / 25.0, 0.18);
            }
            ENDHLSL
        }

        Pass
        {
            Name "LensFlare"
            Blend One One
            HLSLPROGRAM
            #pragma vertex Vert
            #pragma fragment Frag

            // A soft disc for a ghost, brighter at its rim, as the lens's
            // iris makes them.
            float Ghost(float2 at, float2 centre, float r, float aspect)
            {
                float d = length((at - centre) * float2(aspect, 1.0));
                float body = 1.0 - smoothstep(r * 0.7, r, d);
                float e = (d - r * 0.9) / (r * 0.12);
                return body * 0.6 + exp(-e * e) * 0.5;
            }

            half4 Frag(Varyings i) : SV_Target
            {
                float2 uv = i.texcoord;
                float seen = _Flare * SAMPLE_TEXTURE2D_X(_BlitTexture, sampler_PointClamp, float2(0.5, 0.5)).r;
                if (seen <= 0.002) return 0;
                float aspect = _SunRadius.y / max(_SunRadius.x, 1e-6);
                float2 p = (uv - _SunScreen) * float2(aspect, 1.0);
                float r = length(p);
                float3 warm = float3(1.0, 0.93, 0.8);

                // Glare round the sun, and a starburst of six spikes, the
                // second set finer and turned.
                float3 c = warm * exp(-r * 30.0) * 0.25;
                float a = atan2(p.y, p.x);
                float spikes = pow(abs(cos(a * 3.0 + 0.3)), 60.0) + 0.5 * pow(abs(cos(a * 3.0 + 0.82)), 120.0);
                c += warm * spikes * exp(-r * 6.0) * 0.35;

                // A thin streak across, blue-white.
                c += float3(0.75, 0.85, 1.0) * exp(-abs(p.y) * 160.0) * exp(-abs(p.x) * 2.2) * 0.22;

                // A faint ring round it, each colour at its own radius.
                float3 k = (r - float3(0.36, 0.345, 0.33)) * 34.0;
                c += exp(-k * k) * 0.05;

                // Ghosts along the line from the sun through the middle.
                float2 axis = 0.5 - _SunScreen;
                c += float3(0.65, 0.9, 1.0) * Ghost(uv, _SunScreen + axis * 0.45, 0.035, aspect) * 0.12;
                c += float3(1.0, 0.8, 0.55) * Ghost(uv, _SunScreen + axis * 0.8, 0.07, aspect) * 0.06;
                c += float3(0.7, 1.0, 0.75) * Ghost(uv, _SunScreen + axis * 1.25, 0.025, aspect) * 0.14;
                c += float3(0.85, 0.7, 1.0) * Ghost(uv, _SunScreen + axis * 1.55, 0.11, aspect) * 0.045;
                c += float3(1.0, 0.75, 0.7) * Ghost(uv, _SunScreen + axis * 2.1, 0.05, aspect) * 0.09;
                c += float3(0.7, 0.85, 1.0) * Ghost(uv, _SunScreen + axis * 2.45, 0.16, aspect) * 0.03;
                return half4(c * seen, 0);
            }
            ENDHLSL
        }
    }
}
