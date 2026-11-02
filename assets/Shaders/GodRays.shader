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

        #define SAMPLES 40

        float2 _SunScreen;
        float _Density;
        float _Decay;
        float _Threshold;
        float _Intensity;
        float4 _Tint;
        float _GodRaysLevel;

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
                float3 c = min(SAMPLE_TEXTURE2D_X(_BlitTexture, sampler_LinearClamp, uv).rgb, 2.0);
                float l = dot(c, float3(0.2126, 0.7152, 0.0722));
                return half4(c * smoothstep(_Threshold, _Threshold + 0.65, l) * Open(uv), 1);
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
                return half4(rays * _Tint.rgb * _Intensity * level * lerp(0.3, 1.0, Open(uv)), 0);
            }
            ENDHLSL
        }
    }
}
