// A lightning bolt, ported from js/rain.js. Scripts/Rain.cs builds the
// mesh for each strike: a ribbon along every segment of a jagged, forked
// path, uv.x running -1 to 1 across it and uv.y how bright that branch is.
//
// A thin, white-hot core inside a soft blue glow, added to what is behind
// it and far brighter than white, so URP's bloom (Scripts/PostLook.cs, HDR
// on) spreads it. _Bright follows the strike's flicker.
Shader "uwuStack/Lightning"
{
    Properties
    {
        [HDR] _Core ("Core", Color) = (1, 1, 1, 1)
        [HDR] _Glow ("Glow", Color) = (0.55, 0.65, 1, 1)
        _Bright ("Brightness", Float) = 0
    }

    SubShader
    {
        // Before the water, which fades out over the far sea it comes down
        // into.
        Tags { "RenderType" = "Transparent" "RenderPipeline" = "UniversalPipeline" "Queue" = "Transparent-10" }

        Pass
        {
            Name "Lightning"
            Blend One One
            ZWrite Off
            Cull Off

            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            CBUFFER_START(UnityPerMaterial)
                half4 _Core;
                half4 _Glow;
                float _Bright;
            CBUFFER_END

            struct Attributes
            {
                float4 positionOS : POSITION;
                float2 uv : TEXCOORD0;
            };

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float2 uv : TEXCOORD0;
            };

            Varyings vert(Attributes v)
            {
                Varyings o;
                o.positionCS = TransformObjectToHClip(v.positionOS.xyz);
                o.uv = v.uv;
                return o;
            }

            half4 frag(Varyings i) : SV_Target
            {
                float x = abs(i.uv.x);
                float core = exp(-x * x * 60.0);
                float glow = exp(-x * x * 4.0);
                float3 c = (_Core.rgb * core * 4.0 + _Glow.rgb * glow * 0.3) * i.uv.y * min(_Bright, 0.75);
                return half4(c, 1);
            }
            ENDHLSL
        }
    }
}
