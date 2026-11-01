// The effects, which the scene draws unlit and see-through, untouched by
// the fog: the splash's crown and drops, a perfect drop's ring and plate,
// and the clouds.
//
//   SplashCrown   vertex colours on: its alpha runs from 0.08 at the
//                 waterline to 0.95 at the rim, times _BaseColor's alpha
//   SplashDrop    a flat colour, ZWrite on, as three.js left it
//   PerfectRing*  a flat colour faded by alpha, both sides
//   Cloud         Textures/Cloud.png, on a camera-facing quad
//
// _BaseColor's alpha is the opacity the scripts fade (see Scripts/).
Shader "uwuStack/Unlit Transparent"
{
    Properties
    {
        _BaseColor ("Colour", Color) = (1, 1, 1, 1)
        _BaseMap ("Texture", 2D) = "white" {}
        [Toggle(_VERTEX_COLORS)] _VertexColors ("Vertex Colours", Float) = 0
        [Enum(UnityEngine.Rendering.CullMode)] _Cull ("Cull", Float) = 0
        [Toggle] _ZWrite ("Depth Write", Float) = 0
    }

    SubShader
    {
        Tags { "RenderType" = "Transparent" "RenderPipeline" = "UniversalPipeline" "Queue" = "Transparent+10" "IgnoreProjector" = "True" }

        Pass
        {
            Name "Unlit"
            Blend SrcAlpha OneMinusSrcAlpha
            ZWrite [_ZWrite]
            Cull [_Cull]

            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma shader_feature_local _VERTEX_COLORS
            #pragma multi_compile_instancing
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            CBUFFER_START(UnityPerMaterial)
                half4 _BaseColor;
                float4 _BaseMap_ST;
                float _VertexColors;
                float _Cull;
                float _ZWrite;
            CBUFFER_END
            TEXTURE2D(_BaseMap);
            SAMPLER(sampler_BaseMap);

            struct Attributes
            {
                float4 positionOS : POSITION;
                float2 uv : TEXCOORD0;
                half4 color : COLOR;
                UNITY_VERTEX_INPUT_INSTANCE_ID
            };

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float2 uv : TEXCOORD0;
                half4 color : COLOR;
            };

            Varyings vert(Attributes v)
            {
                UNITY_SETUP_INSTANCE_ID(v);
                Varyings o;
                o.positionCS = TransformObjectToHClip(v.positionOS.xyz);
                o.uv = TRANSFORM_TEX(v.uv, _BaseMap);
            #if defined(_VERTEX_COLORS)
                o.color = v.color;
                #if !defined(UNITY_COLORSPACE_GAMMA)
                    o.color.rgb = SRGBToLinear(v.color.rgb);
                #endif
            #else
                o.color = half4(1, 1, 1, 1);
            #endif
                return o;
            }

            half4 frag(Varyings i) : SV_Target
            {
                return SAMPLE_TEXTURE2D(_BaseMap, sampler_BaseMap, i.uv) * i.color * _BaseColor;
            }
            ENDHLSL
        }
    }
}
