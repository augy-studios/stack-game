// Grass tufts and flowers: Lambert lit like the rest (see Lambert.shader),
// coloured by their vertex colours, dark at the root and light at the tip,
// and swaying in the wind, more at the tips, each plant a little out of
// step with the next. The sway is the scene's: sin(t * 1.7 + x * 3.1 +
// z * 2.3) * 0.12 * height, in x, and 0.6 of that in z.
//
// Two ways to feed it:
//   GrassTuft.fbx, Flower*.fbx   one plant per renderer, root at the
//                                object's origin: leave Baked Sway off.
//   Island.fbx's Foliage         every plant merged into one mesh: turn
//                                Baked Sway on. uv0 holds each vertex's
//                                plant root (x, z) and uv1 how far it moves
//                                in (x, z) at full sway, both in the mesh's
//                                own space.
//
// _BaseColor tints the lot: white in the light theme, 0.7 grey in the dark.
Shader "uwuStack/Foliage"
{
    Properties
    {
        _BaseColor ("Tint", Color) = (1, 1, 1, 1)
        [Toggle(_BAKED_SWAY)] _BakedSway ("Baked Sway (merged island mesh)", Float) = 0
        _SwaySpeed ("Sway Speed", Float) = 1
    }

    SubShader
    {
        Tags { "RenderType" = "Opaque" "RenderPipeline" = "UniversalPipeline" "Queue" = "Geometry" }

        HLSLINCLUDE
        #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
        #pragma shader_feature_local _BAKED_SWAY

        CBUFFER_START(UnityPerMaterial)
            half4 _BaseColor;
            float _BakedSway;
            float _SwaySpeed;
        CBUFFER_END

        struct Attributes
        {
            float4 positionOS : POSITION;
            float3 normalOS : NORMAL;
            half4 color : COLOR;
            float2 root : TEXCOORD0;
            float2 reach : TEXCOORD1;
            UNITY_VERTEX_INPUT_INSTANCE_ID
        };

        // The vertex, moved by the wind, in object space.
        float3 Sway(Attributes v)
        {
            float3 p = v.positionOS.xyz;
            float t = _Time.y * _SwaySpeed;
        #if defined(_BAKED_SWAY)
            p.xz += v.reach * sin(t * 1.7 + v.root.x * 3.1 + v.root.y * 2.3);
        #else
            float3 root = TransformObjectToWorld(float3(0, 0, 0));
            float s = sin(t * 1.7 + root.x * 3.1 + root.z * 2.3) * 0.12 * max(p.y, 0.0);
            p.x += s;
            p.z += s * 0.6;
        #endif
            return p;
        }
        ENDHLSL

        Pass
        {
            Name "ForwardLit"
            Tags { "LightMode" = "UniversalForward" }

            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma multi_compile_fog
            #pragma multi_compile_instancing
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl"

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float3 normalWS : TEXCOORD0;
                half3 color : TEXCOORD1;
                half fogFactor : TEXCOORD2;
            };

            Varyings vert(Attributes v)
            {
                UNITY_SETUP_INSTANCE_ID(v);
                Varyings o;
                VertexPositionInputs p = GetVertexPositionInputs(Sway(v));
                o.positionCS = p.positionCS;
                o.normalWS = TransformObjectToWorldNormal(v.normalOS);
                // The FBX holds sRGB colours; lighting wants them linear.
            #if defined(UNITY_COLORSPACE_GAMMA)
                o.color = v.color.rgb;
            #else
                o.color = SRGBToLinear(v.color.rgb);
            #endif
                o.fogFactor = ComputeFogFactor(p.positionCS.z);
                return o;
            }

            half4 frag(Varyings i) : SV_Target
            {
                float3 n = normalize(i.normalWS);
                Light sun = GetMainLight();
                half3 light = sun.color * saturate(dot(n, sun.direction)) + SampleSH(n);
                half3 c = i.color * _BaseColor.rgb * light;
                return half4(MixFog(c, i.fogFactor), 1);
            }
            ENDHLSL
        }

        Pass
        {
            Name "DepthOnly"
            Tags { "LightMode" = "DepthOnly" }
            ZWrite On
            ColorMask R

            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma multi_compile_instancing

            struct Varyings { float4 positionCS : SV_POSITION; };

            Varyings vert(Attributes v)
            {
                UNITY_SETUP_INSTANCE_ID(v);
                Varyings o;
                o.positionCS = TransformObjectToHClip(Sway(v));
                return o;
            }

            half frag(Varyings i) : SV_Target { return 0; }
            ENDHLSL
        }

        Pass
        {
            Name "DepthNormals"
            Tags { "LightMode" = "DepthNormals" }
            ZWrite On

            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma multi_compile_instancing

            struct Varyings { float4 positionCS : SV_POSITION; float3 normalWS : TEXCOORD0; };

            Varyings vert(Attributes v)
            {
                UNITY_SETUP_INSTANCE_ID(v);
                Varyings o;
                o.positionCS = TransformObjectToHClip(Sway(v));
                o.normalWS = TransformObjectToWorldNormal(v.normalOS);
                return o;
            }

            half4 frag(Varyings i) : SV_Target { return half4(normalize(i.normalWS), 0); }
            ENDHLSL
        }
    }
}
