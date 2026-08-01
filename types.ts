export interface Event {
  title: string;
  description: string;
  startDate: Date;
  url: string; // absolute URL for more info / booking
  source: string; // display name of the provider, e.g. "Gresham College"
}