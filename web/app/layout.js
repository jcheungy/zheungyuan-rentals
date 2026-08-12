import "./styles.css";

export const metadata = {
  title: "張園 Zheungyuan | Village House Rentals Hong Kong",
  description:
    "Village-house rental presentation, organised enquiries and renter matching for Hong Kong landlords.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
