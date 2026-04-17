require("mediaplex");//changes made in powershell

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  MessageFlags,
} = require("discord.js");

const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  getVoiceConnection,
} = require("@discordjs/voice");


const path = require("path");
const fs = require("fs");
require("dotenv").config();


const TOKEN     = process.env.BOT_TOKEN; //token
const CLIENT_ID = process.env.CLIENT_ID; //application
const OWNER_ID  = process.env.OWNER_ID; //owner user id
const AUDIO_FILE = path.resolve(__dirname, process.env.AUDIO_FILE || "audio.mp3"); 


//Slash commands
const commands = [
  new SlashCommandBuilder()
    .setName("play")
    .setDescription("Join your voice channel and start looping the audio"),

  new SlashCommandBuilder()
    .setName("pause")
    .setDescription("Pause the looping audio"),

  new SlashCommandBuilder()
    .setName("resume")
    .setDescription("Resume the paused audio"),

  new SlashCommandBuilder()
    .setName("leave")
    .setDescription("Stop playback and leave the voice channel"),
].map((c) => c.toJSON());


//command register with discord
async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  try {
    console.log("Registering slash commands...");
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log("Slash commands registered globally.");
  } 
  
  catch (err) {
    console.error(" Failed to register commands:", err);
  }//catch------------------------------------------------------------------------------>
}



//BOT CLIENT (IDK want to learn)
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
  ],
});



const player = createAudioPlayer();
let currentConnection = null;
let isLooping = false;

//Loop logic -------------------------------------------------------------------------->
function playAudio() {
  if (!fs.existsSync(AUDIO_FILE)) {
    console.error(`❌!!! Audio file not found: ${AUDIO_FILE}`);
    return;
  }
  const resource = createAudioResource(AUDIO_FILE);
  player.play(resource);
}

//track finishes → restart if looping
player.on(AudioPlayerStatus.Idle, () => {
  if (isLooping) {
    console.log("🔁looping the Track...");
    playAudio();
  }
});

player.on("error", (err) => {
  console.error("🔊 Player error:", err.message);
  if (isLooping) {
    console.log("⚡ Attempting to recover playback...");
    setTimeout(playAudio, 1000);
  }
});

//COMMAND HANDLER
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  //Owner gate----------------------------------------------------------------->owner only command access
  if (interaction.user.id !== OWNER_ID) {
    return interaction.reply({
      content: "Vaipu illa raja 🙅",
      flags: MessageFlags.Ephemeral,
    });
  }

  const { commandName, guild, member } = interaction;

  //     /play
  if (commandName === "play") {
    const voiceChannel = member.voice?.channel;

    if (!voiceChannel) {
      return interaction.reply({
        content: "You need to be in a voice channel first!",
        flags: MessageFlags.Ephemeral,
      });
    }

    if (!fs.existsSync(AUDIO_FILE)) {
      return interaction.reply({
        content: `❌ Audio file \`${path.basename(AUDIO_FILE)}\` not found on the server.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply();


//Leaves exciting vc to connnect in new one
    const existing = getVoiceConnection(guild.id);
    if (existing) existing.destroy();

    try {
      currentConnection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId:   guild.id,
        adapterCreator: guild.voiceAdapterCreator,
        selfDeaf: false,
      });

      // Wait until connection is ready (up to 15 seconds)
      await entersState(currentConnection, VoiceConnectionStatus.Ready, 15_000);

      // Handle unexpected disconnects → attempt rejoin
      currentConnection.on(VoiceConnectionStatus.Disconnected, async () => {
        try {
          await Promise.race([
            entersState(currentConnection, VoiceConnectionStatus.Signalling, 5_000),
            entersState(currentConnection, VoiceConnectionStatus.Connecting, 5_000),
          ]);
        } catch {
          console.warn("⚠️ Could not recover connection — destroying.");
          currentConnection.destroy();
          currentConnection = null;
          isLooping = false;
        }
      });

      currentConnection.subscribe(player);
      isLooping = true;
      playAudio();

      // Use editReply since we deferred
      return interaction.editReply({
        content: `▶️ Playing \`${path.basename(AUDIO_FILE)}\` on loop in **${voiceChannel.name}**! 🎵`,
      });
    } catch (err) {
      console.error("❌ Failed to join voice channel:", err);
      if (currentConnection) {
        currentConnection.destroy();
        currentConnection = null;
      }
      return interaction.editReply({
        content: "❌ Failed to join the voice channel. Make sure I have **Connect** and **Speak** permissions!",
      });
    }
  }

  //     /pause 
  if (commandName === "pause") {
    if (player.state.status !== AudioPlayerStatus.Playing) {
      return interaction.reply({
        content: "❗ Nothing is playing right now.",
        flags: MessageFlags.Ephemeral,
      });
    }
    player.pause();
    isLooping = false;
    return interaction.reply({ content: "⏸ Paused!!!" });
  }

  // ── /resume ─────────────────────────────────
  if (commandName === "resume") {
    if (player.state.status !== AudioPlayerStatus.Paused) {
      return interaction.reply({
        content: "❗ Audio is not paused.",
        flags: MessageFlags.Ephemeral,
      });
    }
    player.unpause();
    isLooping = true;
    return interaction.reply({ content: "🔁 Resumed!!!" });
  }

  // ── /leave ──────────────────────────────────
  if (commandName === "leave") {
    const conn = getVoiceConnection(guild.id);
    if (!conn) {
      return interaction.reply({
        content: "❗ I'm not in a voice channel.",
        flags: MessageFlags.Ephemeral,
      });
    }
    isLooping = false;
    player.stop();
    conn.destroy();
    currentConnection = null;
    return interaction.reply({ content: "Poitu varen mamae durr" });
  }
});

//console log ------------------------------------------------------------------------------------>
client.once("clientReady", () => {
  console.log(`Logged in as ${client.user.tag}`);
  console.log(`Owner ID: ${OWNER_ID}`);
  console.log(`Audio file: ${AUDIO_FILE}`);
});

client.on("error", (err) => console.error("🔴 Client error:", err));
process.on("unhandledRejection", (err) => console.error("⚠️ Unhandled rejection:", err));

(async () => {
  await registerCommands();
  await client.login(TOKEN);
})();