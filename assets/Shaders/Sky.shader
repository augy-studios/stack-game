// The sky, as a skybox material (Lighting > Environment > Skybox Material).
//
// The game draws it flat across the screen, top to bottom, so the whole
// gradient shows whichever way the camera looks: horizon colour at 45% of
// the screen's height, easing to the top colour above and the bottom
// colour below, a soft glow low in the middle where the light is, and the
// stars over it all. Being a skybox here changes none of that: it works out
// where on the screen each pixel is, not where it looks.
//
// Scripts/SceneLook.cs moves the colours as the tower climbs.
Shader "uwuStack/Sky"
{
    Properties
    {
        _TopColor ("Top", Color) = (0.62, 0.83, 0.93, 1)
        _HorizonColor ("Horizon", Color) = (0.93, 0.95, 0.85, 1)
        _BottomColor ("Bottom", Color) = (0.87, 0.89, 0.71, 1)
        _Glow ("Glow", Range(0, 1)) = 0.35
        [NoScaleOffset] _StarsTex ("Stars", 2D) = "black" {}
        _StarsOpacity ("Stars Opacity", Range(0, 1)) = 0.7
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
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            CBUFFER_START(UnityPerMaterial)
                half4 _TopColor;
                half4 _HorizonColor;
                half4 _BottomColor;
                half _Glow;
                half _StarsOpacity;
            CBUFFER_END
            TEXTURE2D(_StarsTex);
            SAMPLER(sampler_StarsTex);

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

            half4 frag(Varyings i) : SV_Target
            {
                float2 uv = i.screenPos.xy / i.screenPos.w;
                float y = uv.y;
                half3 c = y > 0.45
                    ? lerp(_HorizonColor.rgb, _TopColor.rgb, smoothstep(0.45, 1.0, y))
                    : lerp(_BottomColor.rgb, _HorizonColor.rgb, smoothstep(0.0, 0.45, y));
                float aspect = _ScreenParams.x / _ScreenParams.y;
                float2 d = float2((uv.x - 0.5) * aspect, y - 0.52);
                c = lerp(c, half3(1, 1, 1), _Glow * exp(-dot(d, d) * 5.0));
                half star = SAMPLE_TEXTURE2D(_StarsTex, sampler_StarsTex, uv).a;
                c = lerp(c, half3(1, 1, 1), star * _StarsOpacity);
                return half4(c, 1);
            }
            ENDHLSL
        }
    }
}
