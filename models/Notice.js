//E:\Downloads\Ten-Ecosystem1\models\Notice.js
const mongoose = require("mongoose");

const NoticeSchema = new mongoose.Schema({

domain:String,

morningMeeting:String,

eveningMeeting:String,

meetingLink:String,

importantNotice:String

});

module.exports =
mongoose.model("Notice", NoticeSchema);
