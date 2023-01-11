require('dotenv').config()
const guildId = process.env.GUILD_ID, welcomeChannelId = process.env.WELCOME_CHANNEL_ID, cutoffId = process.env.MESSAGE_CUTOFF_ID;

const { Client, Events, GatewayIntentBits, Collection } = require('discord.js');
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });
const { Sequelize, DataTypes, Op } = require('sequelize');
const repl = require("repl");

// Slash command handling
const fs = require('node:fs');
const path = require('node:path');
client.commands = new Collection();

const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);
    // Set a new item in the Collection with the key as the command name and the value as the exported module
    if ('data' in command && 'execute' in command) {
        client.commands.set(command.data.name, command);
    } else {
        console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
    }
}

client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const command = interaction.client.commands.get(interaction.commandName);

    if (!command) {
        console.error(`No command matching ${interaction.commandName} was found.`);
        return;
    }


    try {
        // Manual switch as commands require functions in here and I'm too lazy to properly rewrite the bot
        switch (interaction.commandName) {
            case "refresh":
                await interaction.reply({content: "Refreshing (this may take a while)...", ephemeral: true});
                await checkChannel();
                await interaction.editReply("Refreshed!");
                break;
            case "welcome":
                await interaction.reply({content: "Getting links (this may take a while)...", ephemeral: true});
                await checkChannel();
                const messageIdsQuery = await JoinMessages.findAll({
                    where: {welcomed: false},
                    attributes: ['messageId'],
                    order: [['messageId', 'DESC']],
                    limit: 20
                });
                // Verify each message hasn't been deleted yet
                const messageIds = messageIdsQuery.map(x => x.messageId);
                let welcomeChannel = client.channels.cache.get(welcomeChannelId);
                for (let i = 0; i < messageIds.length; i++) {
                    const messageId = messageIds[i];
                    try {
                        await welcomeChannel.messages.fetch(messageId);
                    } catch {
                        messageIds.splice(i, 1);
                        await JoinMessages.destroy({
                            where: {
                                messageId: messageId
                            }
                        });
                        await ProcessedMessages.destroy({
                            where: {
                                messageId: messageId
                            }
                        });
                        i--;
                    }
                }

                const links = messageIds.map(x => messageLinkFormat + x);
                links.reverse();
                const message = "Your links:\n" + links.join('\n');
                await interaction.editReply(message);
                break;
            default:
                await command.execute(interaction);
        }
    } catch (error) {
        console.error(error);
        await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
    }
});

// End handle slash commands

const database = new Sequelize({
    dialect: 'sqlite',
    storage: 'data.sqlite',
    logging: false
})

// Stores all join messages and whether they have been welcomed yet
const JoinMessages = database.define('JoinMessages', {
    messageId: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
        primaryKey: true
    },
    welcomed: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    }
}, {
    timestamps: false
})

// Stores all processed messages to avoid duplicating expensive checks (going further back in history than needed or database modifications)
const ProcessedMessages = database.define('ProcessedMessages', {
    messageId: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
        primaryKey: true
    }
}, {
    timestamps: false
});

JoinMessages.sync({ alter: true });
ProcessedMessages.sync({alter: true });

const messageLinkFormat = `https://discord.com/channels/${guildId}/${welcomeChannelId}/`

// Returns false if no processing occurred, true if message was processed even if message is silently ignored
async function processMsg(message) {
    // Ignore message if before cutoff
    if (parseInt(message.id) < parseInt(cutoffId)) {
        return false
    }
    // Check if message has already been processed
    const searchedId = await ProcessedMessages.findOne({
        where: {messageId: message.id}
    });
    if (searchedId !== null) return false;

    switch (message.type) {
        case 7:
            await database.transaction(async (t) => {
                await ProcessedMessages.create({messageId: message.id},
                    {transaction: t });
                await JoinMessages.findOrCreate({
                    where: {messageId: message.id},
                    transaction: t
                });
            });

            break;
        case 19:
            const repliedToMsgIds = message.reference
            if (repliedToMsgIds.channelId !== welcomeChannelId) break;
            let repliedToMsg;
            try {
                repliedToMsg = await message.channel.messages.fetch(repliedToMsgIds.messageId);
            } catch {
                // Replied to message doesn't exist,
                await ProcessedMessages.create({messageId: message.id});
                break;
            }
            // No stickers in reply (doesn't count)
            if (!repliedToMsg.stickers) {
                await ProcessedMessages.create({messageId: message.id});
                break;
            }

            await database.transaction(async (t) => {
                await JoinMessages.upsert( {
                    messageId: repliedToMsg.id,
                    welcomed: true
                });
                await ProcessedMessages.create({messageId: message.id},
                    {transaction: t });
            });

            break;
        default:
            await ProcessedMessages.create({messageId: message.id});

    }
    return true;
}

async function checkChannel() {

    let welcomeChannel = client.channels.cache.get(welcomeChannelId);
    // let lastMessage = await welcomeChannel.messages.fetch(welcomeChannel.lastMessageId);
    // console.log(lastMessage.id);
    let messages = await welcomeChannel.messages.fetch({limit: 100});

    let lastMessage;
    let done = false;
    while (messages.size != 0 && !done) {
        console.log(`Received ${messages.size} messages`);
        for (const [messageId, message] of messages) {
            done = done || !(await processMsg(message));
        }
        lastMessage = messages.last();
        messages = await welcomeChannel.messages.fetch({limit: 100, before: lastMessage.id});
    }
}

client.once(Events.ClientReady, async c => {
    c.user.setStatus("invisible");
    console.log("Starting bootup sequence...");
    console.log("This may take a while.");
    await checkChannel();
    console.log("Done!");


});

client.login(process.env.DISCORD_TOKEN);