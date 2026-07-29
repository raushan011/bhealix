import { Schema, model, models } from "mongoose";
import { ROLES } from "@/constants/access";
const UserSchema = new Schema({ employeeId:{type:String,required:true,unique:true,index:true}, name:{type:String,required:true}, email:{type:String,required:true,unique:true,index:true}, passwordHash:{type:String,required:true,select:false}, role:{type:String,enum:ROLES,required:true}, permissions:[String], active:{type:Boolean,default:true}, lastLoginAt:Date },{timestamps:true});
export const User = models.User ?? model("User", UserSchema);
