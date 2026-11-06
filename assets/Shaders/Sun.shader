// The sun's disc, as js/scene.js's SUN_VERTEX and SUN_FRAGMENT: in the same
// flat sky as Shaders/Sky.shader, but drawn after the water, whose far haze
// would otherwise hide it, and behind anything solid. A square of the
// screen round the sun, at the far end of the depth, added on: brighter
// than white, so the bloom takes it and it lights the god rays, with a
// soft halo.
//
// Scripts/SunDisc.cs draws it; Scripts/SceneLook.cs sets the globals it
// reads (Scripts/SunPath.cs): _SunGlint, _SunSkyY and _SunDisc.
Shader "uwuStack/Sun"
{
    SubShader
    {
        Tags { "RenderType" = "Transparent" "RenderPipeline" = "UniversalPipeline" "Queue" = "Transparent+5" "IgnoreProjector" = "True" }
        ZWrite Off
        ZTest LEqual
        Cull Off
        Blend One One

        Pass
        {
            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            float4 _SunGlint;
            float _SunSkyY;
            float _SunDisc;

            // Where the sun lands on this camera's screen, 0 to 1, as
            // Scripts/SunPath.cs's ScreenFor().
            float2 SunScreen()
            {
                float3 forward = -UNITY_MATRIX_V[2].xyz;
                float3 heading = normalize(float3(forward.x, 0, forward.z) + float3(0, 0, 1e-5));
                float3 side = cross(float3(0, 1, 0), heading);
                float3 g = _SunGlint.xyz;
                float off = atan2(g.x * side.x + g.z * side.z, g.x * heading.x + g.z * heading.z);
                float aspect = _ScreenParams.x / _ScreenParams.y;
                float across = 2.0 * atan(aspect / abs(UNITY_MATRIX_P[1][1]));
                return float2(0.5 + off / across, _SunSkyY);
            }

            struct Attributes
            {
                float4 positionOS : POSITION;
            };

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float2 at : TEXCOORD0;
            };

            Varyings vert(Attributes v)
            {
                Varyings o;
                float2 corner = v.positionOS.xy * 2.0;   // the quad is -0.5 to 0.5
                o.at = corner * 0.25;
                float aspect = _ScreenParams.x / _ScreenParams.y;
                float2 centre = SunScreen() * 2.0 - 1.0;
                float2 p = centre + corner * 0.5 * float2(1.0 / aspect, 1.0);
                p.y *= _ProjectionParams.x;
            #if UNITY_REVERSED_Z
                float z = 1e-6;
            #else
                float z = 1.0 - 1e-6;
            #endif
                o.positionCS = float4(p, z, 1.0);
                return o;
            }

            half4 frag(Varyings i) : SV_Target
            {
                float r = length(i.at);
                float disc = 1.0 - smoothstep(0.018, 0.023, r);
                float halo = exp(-r * r * 1500.0) * 0.25 + exp(-r * 30.0) * 0.05;
                halo *= 1.0 - smoothstep(0.15, 0.25, r);
                return half4(float3(1.0, 0.95, 0.84) * (disc * 1.5 + halo) * _SunDisc, 1);
            }
            ENDHLSL
        }
    }
}
