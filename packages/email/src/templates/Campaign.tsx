import {
  Html,
  Head,
  Body,
  Container,
  Heading,
  Text,
  Button,
  Hr,
} from '@react-email/components';
import React from 'react';

interface CampaignEmailProps {
  firstName: string;
  subject: string;
  body: string;
  ctaUrl?: string;
  ctaLabel?: string;
  senderName: string;
  unsubscribeUrl: string;
}

export function CampaignEmail({
  firstName,
  subject,
  body,
  ctaUrl,
  ctaLabel,
  senderName,
  unsubscribeUrl,
}: CampaignEmailProps) {
  return (
    <Html lang="fr">
      <Head />
      <Body style={{ backgroundColor: '#f6f9fc', fontFamily: 'Arial, sans-serif' }}>
        <Container style={{ maxWidth: '600px', margin: '0 auto', padding: '20px' }}>
          <Heading style={{ color: '#1a1a2e', fontSize: '22px' }}>{subject}</Heading>
          <Text style={{ color: '#444', fontSize: '16px', lineHeight: '1.6' }}>
            Bonjour {firstName},
          </Text>
          <div
            dangerouslySetInnerHTML={{ __html: body }}
            style={{ color: '#444', fontSize: '16px', lineHeight: '1.6' }}
          />
          {ctaUrl && ctaLabel && (
            <Button
              href={ctaUrl}
              style={{
                backgroundColor: '#6c63ff',
                color: '#fff',
                padding: '14px 28px',
                borderRadius: '6px',
                textDecoration: 'none',
                fontSize: '16px',
                marginTop: '20px',
              }}
            >
              {ctaLabel}
            </Button>
          )}
          <Hr style={{ borderColor: '#e6e6e6', margin: '24px 0' }} />
          <Text style={{ color: '#999', fontSize: '12px' }}>
            Email envoyé par {senderName}.{' '}
            <a href={unsubscribeUrl} style={{ color: '#999' }}>
              Se désabonner
            </a>
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
