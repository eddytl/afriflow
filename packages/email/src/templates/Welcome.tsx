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

interface WelcomeEmailProps {
  firstName: string;
  platformUrl: string;
  tenantName: string;
}

export function WelcomeEmail({ firstName, platformUrl, tenantName }: WelcomeEmailProps) {
  return (
    <Html lang="fr">
      <Head />
      <Body style={{ backgroundColor: '#f6f9fc', fontFamily: 'Arial, sans-serif' }}>
        <Container style={{ maxWidth: '600px', margin: '0 auto', padding: '20px' }}>
          <Heading style={{ color: '#1a1a2e', fontSize: '24px' }}>
            Bienvenue sur {tenantName} 🎉
          </Heading>
          <Text style={{ color: '#444', fontSize: '16px', lineHeight: '1.6' }}>
            Bonjour {firstName},
          </Text>
          <Text style={{ color: '#444', fontSize: '16px', lineHeight: '1.6' }}>
            Merci de nous rejoindre ! Votre compte est prêt. Commencez dès maintenant.
          </Text>
          <Button
            href={platformUrl}
            style={{
              backgroundColor: '#6c63ff',
              color: '#fff',
              padding: '14px 28px',
              borderRadius: '6px',
              textDecoration: 'none',
              fontSize: '16px',
            }}
          >
            Accéder à la plateforme
          </Button>
          <Hr style={{ borderColor: '#e6e6e6', margin: '24px 0' }} />
          <Text style={{ color: '#999', fontSize: '12px' }}>
            Vous recevez cet email car vous vous êtes inscrit(e) sur {tenantName}.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
