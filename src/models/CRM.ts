import { Schema, model, models } from "mongoose";

const AssignmentSchema = new Schema({ doctor:{type:Schema.Types.ObjectId,ref:"Doctor",required:true,index:true}, employee:{type:Schema.Types.ObjectId,ref:"User",required:true,index:true}, date:{type:Date,required:true,index:true}, scheduledTime:String, status:{type:String,enum:["Scheduled","Completed","Cancelled","Unavailable"],default:"Scheduled"}, recurrence:{type:String,enum:["None","Weekly","Monthly"],default:"None"}, overrideReason:String, createdBy:{type:Schema.Types.ObjectId,ref:"User"} },{timestamps:true});
AssignmentSchema.index({doctor:1,employee:1,date:1},{unique:true});
export const Assignment=models.Assignment??model("Assignment",AssignmentSchema);

const VisitSchema = new Schema({ doctor:{type:Schema.Types.ObjectId,ref:"Doctor",required:true,index:true}, employee:{type:Schema.Types.ObjectId,ref:"User",required:true,index:true}, assignment:{type:Schema.Types.ObjectId,ref:"Assignment"}, startedAt:Date, completedAt:Date, status:{type:String,enum:["Planned","In progress","Completed","Unavailable"],default:"Planned"}, outcome:String, notes:String, productsDiscussed:[String], samples:[String], interest:{type:String,enum:["High","Medium","Low","Not interested"]}, location:{latitude:Number,longitude:Number,accuracy:Number} },{timestamps:true});
export const Visit=models.Visit??model("Visit",VisitSchema);

const FollowUpSchema = new Schema({ doctor:{type:Schema.Types.ObjectId,ref:"Doctor",required:true,index:true}, employee:{type:Schema.Types.ObjectId,ref:"User",required:true,index:true}, visit:{type:Schema.Types.ObjectId,ref:"Visit"}, dueAt:{type:Date,required:true,index:true}, note:String, status:{type:String,enum:["Pending","Completed","Cancelled"],default:"Pending"} },{timestamps:true});
export const FollowUp=models.FollowUp??model("FollowUp",FollowUpSchema);

const OrderSchema = new Schema({ doctor:{type:Schema.Types.ObjectId,ref:"Doctor",required:true,index:true}, employee:{type:Schema.Types.ObjectId,ref:"User",required:true,index:true}, items:[{product:{type:String,required:true},quantity:{type:Number,min:1,required:true},unitPrice:{type:Number,min:0,required:true},lineTotal:{type:Number,min:0,required:true}}], total:{type:Number,min:0,required:true}, status:{type:String,enum:["Draft","Confirmed","Delivered","Cancelled"],default:"Confirmed"}, notes:String },{timestamps:true});
export const Order=models.Order??model("Order",OrderSchema);

const AuditSchema = new Schema({actor:{type:Schema.Types.ObjectId,ref:"User"},action:{type:String,required:true,index:true},entityType:String,entityId:Schema.Types.ObjectId,metadata:Schema.Types.Mixed,ip:String,userAgent:String},{timestamps:true});
export const AuditEvent=models.AuditEvent??model("AuditEvent",AuditSchema);
