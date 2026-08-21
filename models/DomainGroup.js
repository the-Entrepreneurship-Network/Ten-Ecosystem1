const mongoose = require("mongoose");

/**
 * The chat group a student in a given domain should join.
 *
 * public/groups.html mapped domains to invite links with a chain of if
 * statements returning "https://chat.whatsapp.com/web-dev-ten",
 * "https://chat.whatsapp.com/mern-ten" and so on. Those are not WhatsApp invite
 * codes — a real one is an opaque token — so every link was dead, and changing
 * a group meant editing and redeploying HTML.
 *
 * `inviteUrl` is validated at the route to be an https link on an allowed chat
 * host, because this value is handed to a student as somewhere safe to click.
 */
const domainGroupSchema = new mongoose.Schema({
    // Matches config/domains.js. Not an enum: the domain list changes and an
    // unknown value must not stop HR from recording a real group.
    domain: { type: String, required: true, unique: true, trim: true, index: true },

    label:     { type: String, default: "", maxlength: 200 },
    inviteUrl: { type: String, required: true, maxlength: 2000 },

    platform: {
        type: String,
        enum: ["whatsapp", "telegram", "discord", "slack", "other"],
        default: "whatsapp"
    },

    // Turned off rather than deleted when a group closes, so the page can say
    // "the group for your domain is being set up" instead of showing a dead link.
    active: { type: Boolean, default: true, index: true },

    note:      { type: String, default: "", maxlength: 500 },
    updatedBy: { type: String, default: "" }
}, { timestamps: true });

module.exports = mongoose.model("DomainGroup", domainGroupSchema);
