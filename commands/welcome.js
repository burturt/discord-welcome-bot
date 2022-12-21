const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('welcome')
        .setDescription("Get links to join messages that need a welcome")
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .setDMPermission(false),
    async execute(interaction) {
        await interaction.reply({content: "Getting links (this may take a while)...", ephemeral: true});
        await new Promise(resolve => setTimeout(resolve, 2000));
        await checkChannel();
        await interaction.editReply("Refreshed!");
    }
}
