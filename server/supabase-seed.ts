import { supabaseServer } from './supabase';
import { db } from './db';
import { trackedPeople } from '@shared/schema';

export async function seedSupabasePersons() {
  console.log('🌱 Seeding Supabase with tracked persons...');
  
  try {
    // Test Supabase connection
    console.log('📡 Testing Supabase connection...');
    
    // Check if persons already exist in Supabase
    const { data: existingPersons, error: checkError } = await supabaseServer
      .from('persons')
      .select('id')
      .limit(1);
    
    if (checkError) {
      console.error('Error checking existing persons:', checkError);
      throw checkError;
    }
    
    if (existingPersons && existingPersons.length > 0) {
      console.log('✅ Persons already seeded, skipping...');
      return;
    }
    
    // Fetch tracked people from current PostgreSQL database
    const trackedPeopleList = await db.select().from(trackedPeople);
    
    if (trackedPeopleList.length === 0) {
      console.warn('⚠️ No tracked people found in database to seed');
      return;
    }
    
    // Transform tracked people to Supabase persons format
    const personsToInsert = trackedPeopleList.map((person: any) => ({
      name: person.name,
      category: person.category,
      avatar: person.avatar || null,
      youtube_id: person.youtubeId || null,
      spotify_id: person.spotifyId || null,
    }));
    
    // Batch insert all persons
    const { data, error } = await supabaseServer
      .from('persons')
      .insert(personsToInsert)
      .select();
    
    if (error) {
      console.error('Error inserting persons:', error);
      throw error;
    }
    
    console.log(`✅ Successfully seeded ${data?.length || 0} persons to Supabase`);
    return data;
  } catch (error) {
    console.error('Failed to seed Supabase persons:', error);
    throw error;
  }
}

export async function getSupabasePersons() {
  const { data, error } = await supabaseServer
    .from('persons')
    .select('*');
  
  if (error) {
    console.error('Error fetching persons from Supabase:', error);
    throw error;
  }
  
  return data || [];
}
