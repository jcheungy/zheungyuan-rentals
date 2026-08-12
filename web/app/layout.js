import "./styles.css";

export const metadata = {
  title: "張園 Zheungyuan | Village House Rentals",
  description: "Thoughtful village-house rental marketing and tenant matching in Hong Kong."
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
