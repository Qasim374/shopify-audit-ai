import "./globals.css";

export const metadata = {
  title: "Shopify Store Audit AI",
  description: "Audit any Shopify store and get a client-ready report — SEO, performance, accessibility, and more.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
