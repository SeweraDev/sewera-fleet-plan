export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      dostepnosc_blokady: {
        Row: {
          created_at: string | null
          created_by: string | null
          dzien: string
          id: string
          typ: string
          zasob_id: string
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          dzien: string
          id?: string
          typ: string
          zasob_id: string
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          dzien?: string
          id?: string
          typ?: string
          zasob_id?: string
        }
        Relationships: []
      }
      flota: {
        Row: {
          aktywny: boolean
          created_at: string
          firma_zew: string | null
          id: string
          jest_zewnetrzny: boolean | null
          kierowca_zew: string | null
          ladownosc_kg: number
          max_palet: number | null
          nr_rej: string
          objetosc_m3: number | null
          oddzial_id: number | null
          telefon_zew: string | null
          typ: string
        }
        Insert: {
          aktywny?: boolean
          created_at?: string
          firma_zew?: string | null
          id?: string
          jest_zewnetrzny?: boolean | null
          kierowca_zew?: string | null
          ladownosc_kg?: number
          max_palet?: number | null
          nr_rej: string
          objetosc_m3?: number | null
          oddzial_id?: number | null
          telefon_zew?: string | null
          typ?: string
        }
        Update: {
          aktywny?: boolean
          created_at?: string
          firma_zew?: string | null
          id?: string
          jest_zewnetrzny?: boolean | null
          kierowca_zew?: string | null
          ladownosc_kg?: number
          max_palet?: number | null
          nr_rej?: string
          objetosc_m3?: number | null
          oddzial_id?: number | null
          telefon_zew?: string | null
          typ?: string
        }
        Relationships: [
          {
            foreignKeyName: "flota_oddzial_id_fkey"
            columns: ["oddzial_id"]
            isOneToOne: false
            referencedRelation: "oddzialy"
            referencedColumns: ["id"]
          },
        ]
      }
      flota_zewnetrzna: {
        Row: {
          aktywny: boolean
          created_at: string
          firma: string
          id: string
          kierowca: string | null
          ladownosc_kg: number | null
          max_palet: number | null
          nr_rej: string
          objetosc_m3: number | null
          oddzial_id: number | null
          tel: string | null
          typ: string
        }
        Insert: {
          aktywny?: boolean
          created_at?: string
          firma: string
          id?: string
          kierowca?: string | null
          ladownosc_kg?: number | null
          max_palet?: number | null
          nr_rej: string
          objetosc_m3?: number | null
          oddzial_id?: number | null
          tel?: string | null
          typ?: string
        }
        Update: {
          aktywny?: boolean
          created_at?: string
          firma?: string
          id?: string
          kierowca?: string | null
          ladownosc_kg?: number | null
          max_palet?: number | null
          nr_rej?: string
          objetosc_m3?: number | null
          oddzial_id?: number | null
          tel?: string | null
          typ?: string
        }
        Relationships: [
          {
            foreignKeyName: "flota_zewnetrzna_oddzial_id_fkey"
            columns: ["oddzial_id"]
            isOneToOne: false
            referencedRelation: "oddzialy"
            referencedColumns: ["id"]
          },
        ]
      }
      kierowcy: {
        Row: {
          aktywny: boolean
          created_at: string
          id: string
          imie_nazwisko: string
          oddzial_id: number | null
          tel: string | null
          uprawnienia: string | null
          user_id: string | null
        }
        Insert: {
          aktywny?: boolean
          created_at?: string
          id?: string
          imie_nazwisko: string
          oddzial_id?: number | null
          tel?: string | null
          uprawnienia?: string | null
          user_id?: string | null
        }
        Update: {
          aktywny?: boolean
          created_at?: string
          id?: string
          imie_nazwisko?: string
          oddzial_id?: number | null
          tel?: string | null
          uprawnienia?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "kierowcy_oddzial_id_fkey"
            columns: ["oddzial_id"]
            isOneToOne: false
            referencedRelation: "oddzialy"
            referencedColumns: ["id"]
          },
        ]
      }
      kurs_przystanki: {
        Row: {
          created_at: string
          id: string
          kolejnosc: number
          kurs_id: string
          status: string
          zlecenie_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          kolejnosc?: number
          kurs_id: string
          status?: string
          zlecenie_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          kolejnosc?: number
          kurs_id?: string
          status?: string
          zlecenie_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "kurs_przystanki_kurs_id_fkey"
            columns: ["kurs_id"]
            isOneToOne: false
            referencedRelation: "kursy"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kurs_przystanki_zlecenie_id_fkey"
            columns: ["zlecenie_id"]
            isOneToOne: false
            referencedRelation: "zlecenia"
            referencedColumns: ["id"]
          },
        ]
      }
      kurs_odcinki_techniczne: {
        Row: {
          id: string
          kurs_id: string
          opis: string
          km: number
          created_at: string
        }
        Insert: {
          id?: string
          kurs_id: string
          opis: string
          km: number
          created_at?: string
        }
        Update: {
          id?: string
          kurs_id?: string
          opis?: string
          km?: number
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "kurs_odcinki_techniczne_kurs_id_fkey"
            columns: ["kurs_id"]
            isOneToOne: false
            referencedRelation: "kursy"
            referencedColumns: ["id"]
          },
        ]
      }
      kursy: {
        Row: {
          created_at: string
          dzien: string
          flota_id: string | null
          godzina_start: string | null
          id: string
          kierowca_id: string | null
          kierowca_nazwa: string | null
          km_rozliczeniowe: number | null
          nr_rej_zewn: string | null
          numer: string | null
          oddzial_id: number | null
          status: string
          ts_powrot: string | null
          ts_wyjazd: string | null
        }
        Insert: {
          created_at?: string
          dzien?: string
          flota_id?: string | null
          godzina_start?: string | null
          id?: string
          kierowca_id?: string | null
          kierowca_nazwa?: string | null
          km_rozliczeniowe?: number | null
          nr_rej_zewn?: string | null
          numer?: string | null
          oddzial_id?: number | null
          status?: string
          ts_powrot?: string | null
          ts_wyjazd?: string | null
        }
        Update: {
          created_at?: string
          dzien?: string
          flota_id?: string | null
          godzina_start?: string | null
          id?: string
          kierowca_id?: string | null
          kierowca_nazwa?: string | null
          km_rozliczeniowe?: number | null
          nr_rej_zewn?: string | null
          numer?: string | null
          oddzial_id?: number | null
          status?: string
          ts_powrot?: string | null
          ts_wyjazd?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "kursy_flota_id_fkey"
            columns: ["flota_id"]
            isOneToOne: false
            referencedRelation: "flota"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kursy_oddzial_id_fkey"
            columns: ["oddzial_id"]
            isOneToOne: false
            referencedRelation: "oddzialy"
            referencedColumns: ["id"]
          },
        ]
      }
      oddzialy: {
        Row: {
          aktywny: boolean
          created_at: string
          id: number
          nazwa: string
        }
        Insert: {
          aktywny?: boolean
          created_at?: string
          id?: number
          nazwa: string
        }
        Update: {
          aktywny?: boolean
          created_at?: string
          id?: number
          nazwa?: string
        }
        Relationships: []
      }
      powiadomienia: {
        Row: {
          created_at: string | null
          id: string
          przeczytane: boolean
          tresc: string
          typ: string
          user_id: string
          zlecenie_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          przeczytane?: boolean
          tresc: string
          typ: string
          user_id: string
          zlecenie_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          przeczytane?: boolean
          tresc?: string
          typ?: string
          user_id?: string
          zlecenie_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "powiadomienia_zlecenie_id_fkey"
            columns: ["zlecenie_id"]
            isOneToOne: false
            referencedRelation: "zlecenia"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          branch: string | null
          created_at: string
          full_name: string
          id: string
        }
        Insert: {
          branch?: string | null
          created_at?: string
          full_name?: string
          id: string
        }
        Update: {
          branch?: string | null
          created_at?: string
          full_name?: string
          id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      zlecenia: {
        Row: {
          created_at: string
          deadline_wz: string | null
          dzien: string
          flaga_brak_wz: boolean
          id: string
          kurs_id: string | null
          ma_wz: boolean
          nadawca_id: string | null
          numer: string
          oddzial_id: number | null
          preferowana_godzina: string | null
          status: string
          typ_pojazdu: string | null
        }
        Insert: {
          created_at?: string
          deadline_wz?: string | null
          dzien?: string
          flaga_brak_wz?: boolean
          id?: string
          kurs_id?: string | null
          ma_wz?: boolean
          nadawca_id?: string | null
          numer: string
          oddzial_id?: number | null
          preferowana_godzina?: string | null
          status?: string
          typ_pojazdu?: string | null
        }
        Update: {
          created_at?: string
          deadline_wz?: string | null
          dzien?: string
          flaga_brak_wz?: boolean
          id?: string
          kurs_id?: string | null
          ma_wz?: boolean
          nadawca_id?: string | null
          numer?: string
          oddzial_id?: number | null
          preferowana_godzina?: string | null
          status?: string
          typ_pojazdu?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "zlecenia_oddzial_id_fkey"
            columns: ["oddzial_id"]
            isOneToOne: false
            referencedRelation: "oddzialy"
            referencedColumns: ["id"]
          },
        ]
      }
      zlecenia_wz: {
        Row: {
          adres: string | null
          created_at: string
          id: string
          ilosc_palet: number | null
          klasyfikacja: string | null
          masa_kg: number
          nr_zamowienia: string | null
          numer_wz: string | null
          objetosc_m3: number
          odbiorca: string | null
          tel: string | null
          uwagi: string | null
          wartosc_netto: number | null
          km_prosta_override: number | null
          zlecenie_id: string
        }
        Insert: {
          adres?: string | null
          created_at?: string
          id?: string
          ilosc_palet?: number | null
          klasyfikacja?: string | null
          masa_kg?: number
          nr_zamowienia?: string | null
          numer_wz?: string | null
          objetosc_m3?: number
          odbiorca?: string | null
          tel?: string | null
          uwagi?: string | null
          wartosc_netto?: number | null
          km_prosta_override?: number | null
          zlecenie_id: string
        }
        Update: {
          adres?: string | null
          created_at?: string
          id?: string
          ilosc_palet?: number | null
          klasyfikacja?: string | null
          masa_kg?: number
          nr_zamowienia?: string | null
          numer_wz?: string | null
          objetosc_m3?: number
          odbiorca?: string | null
          tel?: string | null
          uwagi?: string | null
          wartosc_netto?: number | null
          km_prosta_override?: number | null
          zlecenie_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "zlecenia_wz_zlecenie_id_fkey"
            columns: ["zlecenie_id"]
            isOneToOne: false
            referencedRelation: "zlecenia"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      oblicz_deadline_wz: { Args: { dzien_dostawy: string }; Returns: string }
    }
    Enums: {
      app_role: "admin" | "zarzad" | "dyspozytor" | "sprzedawca" | "kierowca"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "zarzad", "dyspozytor", "sprzedawca", "kierowca"],
    },
  },
} as const
