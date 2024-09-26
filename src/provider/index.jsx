import { ChakraBaseProvider, extendTheme } from '@chakra-ui/react';

const theme = extendTheme({
    config: {
        initialColorMode: 'dark',
        useSystemColorMode: false,
    }
})

const Provider = ({ children }) => {
    return (
        <ChakraBaseProvider theme={theme}>
            {children}
        </ChakraBaseProvider>
    )
}

export default Provider;