# Privacy, Terms, Contact (DRAFT placeholders, for Fred's review)
These need real legal text. Do not publish placeholders.

Decided 17 Nov 2026:
- Before a portrait is generated, the customer must check "I own this photo or have the right to use it." The server refuses the order without that confirmation and stores the confirmation time on the order as `photoRightsAt`. The same confirmation is required for Etsy and gift orders created in the admin form.
- Digital portrait files are final sale. The only remedy for a defective or undelivered digital file is a replacement file.
- Image processor: OpenAI while `IMAGE_PROVIDER=openai`. Qwen-Image-Edit-2511 (Apache-2.0) through the configured Hugging Face Inference Provider, Hugging Face Inference Endpoint, or self-hosted endpoint while `IMAGE_PROVIDER=qwen`.

Still open:
- Privacy: what we collect (email, pet photo, pet name, shipping address via Stripe, photo-rights confirmation time), processors (Stripe, the image processor above, Resend email, Printful printing, Railway hosting), photo retention **[FRED]**, marketing emails + unsubscribe link (exists: /u/:id), use of sample photos only with consent **[FRED]**.
- Terms: business name Sun Marketing, LLC **[FRED: confirm legal entity shown publicly]**, AI-generated artwork disclosure wording **[FRED decides]**, personal-use license for files **[FRED]**, governing law **[FRED]**.
- Contact: sunmarketingllc@gmail.com (consider hello@custompetportraitstudio.com), business address **[FRED: publish or not]**.
