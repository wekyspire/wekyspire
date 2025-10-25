<template>
  <div class="audio-controller" v-if="showToggleButton">
    <div 
      class="audio-toggle-icon" 
      @click="toggleAudio"
      :class="{ 'muted': isMuted }"
    >
      {{ isMuted ? '🔇' : '🔊' }}
  </div>
  </div>
</template>

<script>
import frontendEventBus from '../../frontendEventBus.js';

export default {
  name: 'AudioControllerScreen',
  data() {
    return {
      isMuted: false,
      showToggleButton: true,
      // 音效轨道管理，同一轨道只能同时播放一个音效
      soundTracks: new Map(),
      defaultVolume: 0.25
    };
  },
  mounted() {
    // 监听播放音效事件
    frontendEventBus.on('play-sound', this.playSound);
  },
  beforeUnmount() {
    frontendEventBus.off('play-sound', this.playSound);
  },
  methods: {
    handleGameStageChange(stage) {
      this.updateToggleButtonVisibility(stage);
    },
    
    toggleAudio() {
      this.isMuted = !this.isMuted;
      console.log(`Audio ${this.isMuted ? 'muted' : 'unmuted'}`);
      if(this.isMuted) {
        // 把所有正在播放的audio声音改成0
        this.soundTracks.forEach((sound) => {
          if(sound) sound.volume = 0;
        });
      } else {
        // 把所有正在播放的audio声音改成默认值
        this.soundTracks.forEach((sound) => {
          if(sound) sound.volume = this.defaultVolume;
        });
      }
    },
    
    playSound(payload) {
      // payload应该包含soundFile和soundTrack
      const { soundFile, soundTrack } = payload;
      
      if (this.isMuted) {
        console.log(`Audio is muted, skipping sound: ${soundFile}`);
        return;
      }
      
      // 检查是否已有相同轨道的音效在播放
      if (this.soundTracks.has(soundTrack)) {
        // 停止当前轨道的音效
        const existingSound = this.soundTracks.get(soundTrack);
        if (existingSound && !existingSound.paused) {
          existingSound.pause();
          existingSound.currentTime = 0;
        }
      }
      if(soundFile) {
        // 创建并播放新音效
        try {
          const audio = new Audio(soundFile);
          audio.volume = this.defaultVolume;
          audio.play();
          
          // 保存到轨道管理器
          this.soundTracks.set(soundTrack, audio);
          
          // 监听播放结束事件，从轨道管理器中移除
          audio.addEventListener('ended', () => {
            if (this.soundTracks.get(soundTrack) === audio) {
              this.soundTracks.delete(soundTrack);
            }
          });
          
          console.log(`Playing sound: ${soundFile} on track: ${soundTrack}`);
        } catch (error) {
          console.error(`Failed to play sound: ${soundFile}`, error);
        }
      }
    }
  }
};
</script>

<style scoped>
.audio-controller {
  position: fixed;
  top: 20px;
  right: 20px;
  z-index: 890; /* 高于其他界面元素，但是低于DialogueScreen和CutsceneScreen */
}

.audio-toggle-icon {
  width: 30px;
  height: 30px;
  background: #6a6a6a;
  border: 1px solid #ccc;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 20px;
  font-weight: bold;
  user-select: none;
  color:white;
  transition: all 0.3s ease;
}

.audio-toggle-icon:hover {
  background-color: rgba(50, 50, 50, 0.7);
  /* transform: scale(1.1); */
}

.audio-toggle-icon.muted {
  background-color: #6a6a6a;
}

</style>