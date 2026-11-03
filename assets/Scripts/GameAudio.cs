using UnityEngine;

namespace UwuStack
{
    // Every sound in the game, played as js/audio.js plays it: the same
    // levels, the same pitch for how hard something hit, a little
    // different each time, and the water's sounds quieter and duller the
    // further below the layer being built the water is.
    //
    //   drop      a slab landing with a cut: Audio/Drop*.wav
    //   perfect   the next note up C major for every perfect in a row, C3
    //             to C6: Audio/Perfect01_C3.wav to Perfect22_C6.wav
    //   grow      a run of perfects pushing a layer's side back out:
    //             Audio/Grow.wav, pitched down, 0.67 s long
    //   hit       a cut-off piece knocking a layer below: Audio/Hit.wav
    //   land      a piece landing on the island: Audio/Land*.wav
    //   splash    a piece going into the water: Audio/Splash.wav
    //   gameOver  Audio/GameOver.wav
    //   water     the waves lapping, on a loop: Audio/WaterLoop.wav
    //   rain      a game in the rain, on a loop, softened and kept well
    //             under the waves: Audio/RainLoop.wav (Scripts/Rain.cs)
    //   thunder   a long, soft roll, the three takes in turn: Audio/
    //             Thunder1.wav to Thunder3.wav, the further off the
    //             quieter, duller, lower and slower to swell
    //
    // The browser ran its mix into a limiter and gave the splash nearly
    // twice full level; Unity's volumes stop at 1, so every level here is
    // halved (headroom) and nothing is limited. Turn up the AudioMixer
    // group, or the headroom, to taste.
    public class GameAudio : MonoBehaviour
    {
        [Header("Clips")]
        public AudioClip[] drop;
        public AudioClip[] perfect = new AudioClip[22];
        public AudioClip grow;
        public AudioClip hit;
        public AudioClip[] land;
        public AudioClip splash;
        public AudioClip gameOver;
        public AudioClip waterLoop;
        public AudioClip rainLoop;
        public AudioClip[] thunder;

        [Header("Mix")]
        public UnityEngine.Audio.AudioMixerGroup output;
        [Range(0, 1)] public float master = 0.9f;
        [Range(0, 1)] public float headroom = 0.5f;
        public bool soundOn = true;

        // Each recording's level, as js/audio.js has it.
        const float HitGain = 0.33f;
        const float SplashGain = 1.9f;
        const float GrowGain = 0.24f;
        const float GrowPitch = 0.85f;
        const float WaterGain = 1.3f * 0.9f;
        // The rain's loop is about 4 dB louder than the waves'; this puts it
        // about 8 dB under them.
        const float RainGain = 0.26f;
        const float ThunderGain = 0.5f;

        const int Voices = 16;
        AudioSource[] voices;
        AudioLowPassFilter[] filters;
        int nextVoice;

        AudioSource water;
        AudioLowPassFilter waterFilter;
        float waterLevel, waterTarget, waterCutoff = 18000, waterCutoffTarget = 18000;

        AudioSource rain;
        float rainLevel, rainTarget;

        // Thunder plays on its own voices, so each can swell in slowly.
        struct Roll
        {
            public AudioSource source;
            public AudioLowPassFilter filter;
            public float start, rise, length, peak;
        }
        const int Rolls = 3;
        Roll[] rolls;
        int nextRoll, nextTake;

        void Awake()
        {
            voices = new AudioSource[Voices];
            filters = new AudioLowPassFilter[Voices];
            for (int i = 0; i < Voices; i++)
            {
                var go = new GameObject("Voice");
                go.transform.SetParent(transform, false);
                voices[i] = Source(go);
                filters[i] = go.AddComponent<AudioLowPassFilter>();
            }
            var w = new GameObject("Water");
            w.transform.SetParent(transform, false);
            water = Source(w);
            water.loop = true;
            water.clip = waterLoop;
            water.volume = 0;
            waterFilter = w.AddComponent<AudioLowPassFilter>();
            if (waterLoop != null) water.Play();

            var rn = new GameObject("Rain");
            rn.transform.SetParent(transform, false);
            rain = Source(rn);
            rain.loop = true;
            rain.clip = rainLoop;
            rain.volume = 0;
            // Nothing low to rumble under the game, and the top softened.
            rn.AddComponent<AudioHighPassFilter>().cutoffFrequency = 200;
            rn.AddComponent<AudioLowPassFilter>().cutoffFrequency = 7000;
            if (rainLoop != null)
            {
                rain.Play();
                rain.time = Random.value * rainLoop.length;
            }

            rolls = new Roll[Rolls];
            for (int i = 0; i < Rolls; i++)
            {
                var go = new GameObject("Thunder");
                go.transform.SetParent(transform, false);
                rolls[i].source = Source(go);
                rolls[i].filter = go.AddComponent<AudioLowPassFilter>();
            }
        }

        AudioSource Source(GameObject go)
        {
            var s = go.AddComponent<AudioSource>();
            s.playOnAwake = false;
            s.spatialBlend = 0;
            s.outputAudioMixerGroup = output;
            return s;
        }

        static float Jitter(float amount)
        {
            return 1 + (Random.value - 0.5f) * amount;
        }

        // A sound gap layers below the one being built: quieter by about the
        // inverse square of the distance past the first few layers, and
        // duller, since distance takes the highs off a sound first.
        public static void Far(float gap, out float gain, out float cutoff)
        {
            float d = Mathf.Max(0, gap);
            gain = 1 / (1 + (d / 3) * (d / 3));
            cutoff = 18000 / (1 + d * 0.6f);
        }

        void Play(AudioClip clip, float level, float pitch = 1, float cutoff = 22000)
        {
            if (!soundOn || clip == null) return;
            int i = nextVoice;
            nextVoice = (nextVoice + 1) % Voices;
            AudioSource s = voices[i];
            s.Stop();
            s.clip = clip;
            s.volume = Mathf.Clamp01(level * master * headroom);
            s.pitch = pitch;
            filters[i].cutoffFrequency = Mathf.Min(22000, cutoff);
            s.Play();
        }

        static AudioClip Any(AudioClip[] clips)
        {
            return clips == null || clips.Length == 0 ? null : clips[Random.Range(0, clips.Length)];
        }

        // strength: 1 for a tap, 0.7 for a drop the turn limit made.
        public void PlayDrop(float strength = 1)
        {
            Play(Any(drop), strength);
        }

        // step: how many perfects in a row this makes, from 1.
        public void PlayPerfect(int step)
        {
            int n = Mathf.Clamp(step - 1, 0, perfect.Length - 1);
            Play(perfect[n], 1);
        }

        public void PlayGrow()
        {
            Play(grow, GrowGain, GrowPitch * Jitter(0.06f));
        }

        // Harder knocks a little lower, and no two quite the same.
        public void PlayHit(float strength = 0.5f)
        {
            Play(hit, HitGain * (0.2f + 0.8f * strength), (1.08f - 0.12f * strength) * Jitter(0.1f));
        }

        // The clips hold a landing at full strength.
        public void PlayLand(float strength = 0.5f)
        {
            Play(Any(land), (0.14f + 0.22f * strength) / 0.36f);
        }

        // gap: how many layers below the one being built it hit the water.
        // Even a slow piece makes a splash worth hearing; a bigger one is a
        // little lower.
        public void PlaySplash(float strength = 0.6f, float gap = 0)
        {
            float size = 0.6f + 0.4f * strength;
            Far(gap, out float gain, out float cutoff);
            Play(splash, SplashGain * size * gain, (1.12f - 0.22f * strength) * Jitter(0.06f), cutoff);
        }

        public void PlayGameOver()
        {
            Play(gameOver, 1);
        }

        // The impacts of a falling piece, as FallingPiece raises them.
        // gap: how far below the layer being built the water is, in layers.
        public void PlayImpact(Fall.Impact impact, float gap)
        {
            float s = (float)impact.Strength;
            if (impact.Kind == Fall.ImpactKind.Water) PlaySplash(s, gap);
            else if (impact.Kind == Fall.ImpactKind.Island) PlayLand(s);
            else PlayHit(s);
        }

        // gap: how many layers the water is below the one being built.
        // held: silent, whatever the gap, while the game is paused or over.
        public void SetWater(float gap, bool held = false)
        {
            Far(gap, out float gain, out float cutoff);
            waterTarget = held ? 0 : WaterGain * gain;
            waterCutoffTarget = cutoff;
        }

        // level: 0 for none, up to 1 for a storm's. Eased in and out over a
        // couple of seconds.
        public void SetRain(float level)
        {
            rainTarget = RainGain * level;
        }

        // near: 0 far off, 1 close by. side: -1 to 1, where across the sky.
        public void PlayThunder(float near, float side)
        {
            if (!soundOn || thunder == null || thunder.Length == 0) return;
            AudioClip clip = thunder[nextTake++ % thunder.Length];
            if (clip == null) return;
            ref Roll roll = ref rolls[nextRoll];
            nextRoll = (nextRoll + 1) % Rolls;
            roll.source.Stop();
            roll.source.clip = clip;
            roll.source.pitch = (0.88f + 0.12f * near) * Jitter(0.06f);
            roll.source.panStereo = Mathf.Clamp(side * 0.6f, -1, 1);
            roll.source.volume = 0;
            roll.filter.cutoffFrequency = Mathf.Min(22000, 450 + 7500 * Mathf.Pow(near, 1.6f));
            roll.start = Time.unscaledTime;
            roll.rise = 0.12f + 0.3f * (1 - near);
            roll.length = clip.length / roll.source.pitch;
            roll.peak = ThunderGain * (0.3f + 0.7f * near);
            roll.source.Play();
        }

        void Update()
        {
            // Eased with a quarter-second time constant, as the game's is.
            float k = 1 - Mathf.Exp(-Time.unscaledDeltaTime / 0.25f);
            waterLevel += (waterTarget - waterLevel) * k;
            waterCutoff += (waterCutoffTarget - waterCutoff) * k;
            water.volume = soundOn ? Mathf.Clamp01(waterLevel * master * headroom) : 0;
            waterFilter.cutoffFrequency = Mathf.Min(22000, waterCutoff);

            // The rain eases in over about a second and out a little faster.
            float kr = 1 - Mathf.Exp(-Time.unscaledDeltaTime / (rainTarget > rainLevel ? 0.8f : 0.6f));
            rainLevel += (rainTarget - rainLevel) * kr;
            rain.volume = soundOn ? Mathf.Clamp01(rainLevel * master * headroom) : 0;

            // Each roll swells in, holds, and eases out over its last second.
            for (int i = 0; i < Rolls; i++)
            {
                if (!rolls[i].source.isPlaying) continue;
                float t = Time.unscaledTime - rolls[i].start;
                float shape = Mathf.Min(Mathf.Clamp01(t / rolls[i].rise), Mathf.Clamp01(rolls[i].length - t));
                rolls[i].source.volume = soundOn ? Mathf.Clamp01(rolls[i].peak * shape * master * headroom) : 0;
            }
        }
    }
}
