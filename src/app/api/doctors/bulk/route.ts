import { z } from "zod";
import { connectDb } from "@/lib/db/mongoose";
import { Doctor } from "@/models/Doctor";
import { fail,ok } from "@/lib/api";

const itemSchema=z.object({googlePlaceId:z.string().min(2),name:z.string().min(2),doctorType:z.string().min(2),fullAddress:z.string().default(""),phone:z.string().default(""),website:z.string().default(""),googleMapsUrl:z.string().default(""),latitude:z.number().min(-90).max(90),longitude:z.number().min(-180).max(180),rating:z.number().min(0).max(5).optional(),reviewCount:z.number().int().min(0).optional(),distanceKm:z.number().min(0).max(100)});
const schema=z.object({doctors:z.array(itemSchema).min(1).max(500)});

export async function POST(req:Request){try{const {doctors}=schema.parse(await req.json());await connectDb();let created=0,updated=0;const ids:string[]=[];for(const value of doctors){const existing=await Doctor.findOne({googlePlaceId:value.googlePlaceId});const set={name:value.name,doctorTypes:[value.doctorType],specialties:[value.doctorType],clinicName:value.name,fullAddress:value.fullAddress,phones:value.phone?[value.phone]:[],website:value.website,googleMapsUrl:value.googleMapsUrl,googlePlaceId:value.googlePlaceId,rating:value.rating,reviewCount:value.reviewCount,location:{type:"Point",coordinates:[value.longitude,value.latitude]},dataSource:"Google Places API",lastSyncedAt:new Date()};if(existing){existing.set(set);await existing.save();updated++;ids.push(String(existing._id));continue}const code=`BHG-${value.googlePlaceId.replace(/[^a-zA-Z0-9]/g,"").slice(-14)}`;const doctor=await Doctor.create({...set,code,priority:"Medium",stage:"New",status:"Active"});created++;ids.push(String(doctor._id))}return ok({created,updated,total:doctors.length,ids},201)}catch(e){return fail(e)}}
